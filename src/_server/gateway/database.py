"""Durable gateway store. Only the backend receives the dedicated database role."""
import hashlib,re,sqlite3
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import unquote,urlsplit

class Row(dict):
    def __getitem__(self,key):return list(self.values())[key] if isinstance(key,int) else super().__getitem__(key)

class Cursor:
    def __init__(self,cursor):self.cursor=cursor
    def fetchone(self):
        row=self.cursor.fetchone();return Row(row) if row is not None else None
    def fetchall(self):return [Row(row) for row in self.cursor.fetchall()]
    def __iter__(self):return (Row(row) for row in self.cursor)
    @property
    def rowcount(self):return self.cursor.rowcount

class Postgres:
    def __init__(self,connection):self.connection=connection
    def execute(self,sql,args=()):
        sql=re.sub(r"'(?:''|[^'])*'|\?",lambda match:match[0].replace('%','%%') if match[0].startswith("'") else '%s',sql)
        return Cursor(self.connection.execute(sql,args))

class Database:
    def __init__(self,path=None,dsn=None,project_ref='',ca_file=None):
        self.path=Path(path) if path else None;self.dsn=dsn;self.persistent=True;self.ca_file=ca_file
        if dsn:
            parsed=urlsplit(dsn);username=unquote(parsed.username or '')
            direct=parsed.hostname=='db.'+project_ref+'.supabase.co'
            pooled=(parsed.hostname or '').endswith('.pooler.supabase.com') and username.endswith('.'+project_ref)
            role=username.split('.')[0]
            if parsed.scheme not in {'postgres','postgresql'} or role!='saras_v2_app' or not re.fullmatch(r'[a-z]{20}',project_ref) or not (direct or pooled) or parsed.port not in {5432,6543}:
                raise ValueError('Use the dedicated SARAS V2 database role for the configured project')
            if not ca_file or not Path(ca_file).is_file():raise ValueError('A verified database root CA file is required')
        elif not self.path:raise ValueError('Database location required')
        else:self.path.parent.mkdir(parents=True,exist_ok=True)
    @contextmanager
    def db(self,lock='gateway-state'):
        if self.dsn:
            import psycopg
            from psycopg.rows import dict_row
            connection=psycopg.connect(self.dsn,prepare_threshold=None,row_factory=dict_row,connect_timeout=8,sslmode='verify-full',sslrootcert=str(self.ca_file))
            try:
                with connection.transaction():
                    connection.execute('SET LOCAL search_path TO saras_v2_private, pg_catalog')
                    connection.execute("SET LOCAL statement_timeout TO '15000ms'")
                    connection.execute("SET LOCAL lock_timeout TO '5000ms'")
                    if lock:
                        identifier=int.from_bytes(hashlib.sha256(lock.encode()).digest()[:8],'big',signed=True)
                        connection.execute('SELECT pg_advisory_xact_lock(%s)',(identifier,))
                    yield Postgres(connection)
            finally:connection.close()
        else:
            connection=sqlite3.connect(self.path,timeout=15);connection.row_factory=lambda cursor,row:Row(zip([c[0] for c in cursor.description],row))
            try:
                connection.execute('PRAGMA foreign_keys=ON');connection.execute('BEGIN IMMEDIATE')
                with connection:yield connection
            finally:connection.close()
    def initialize_local(self):
        if self.dsn:raise ValueError('Cloud migrations require a reviewed migration; runtime cannot create schemas')
        sql=(Path(__file__).with_name('schema.sql')).read_text(encoding='utf-8').split('-- POSTGRES SECURITY')[0]
        sql=sql.replace('BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY','INTEGER PRIMARY KEY').replace('DOUBLE PRECISION','REAL')
        connection=sqlite3.connect(self.path)
        try:
            connection.executescript(sql)
            if 'account_label' not in {row[1] for row in connection.execute('PRAGMA table_info(pairs)')}:connection.execute('ALTER TABLE pairs ADD COLUMN account_label TEXT')
            connection.commit()
        finally:connection.close()

"""Shared command contract. Model outputs are proposals, never authority."""
import json
SPECS = {
 'desktop_scroll_start':{'args':{'window':'str','direction':'str'},'help':'Continuous foreground scrolling until Stop, focus change or connection loss; no page-end detection','sensitive':True},
 'stop_scroll':{'args':{},'help':'Stop current/pending continuous scrolling'},
 'current_time':{'args':{},'help':'Read this laptop local date, time and UTC offset'},
 'weather_city':{'args':{'city':'str'},'help':'Fetch latest model-based city weather from Open-Meteo; sends city name to provider'},
 'clipboard_read':{'args':{},'help':'Read up to 4000 copied characters into private cloud command log, on explicit request only','sensitive':True,'confirmation':'CLIPBOARD READ'},
 'clipboard_save':{'args':{'folder':'str','path':'str'},'help':'Save current copied text to a new shared .txt file; no overwrite','sensitive':True,'confirmation':'CLIPBOARD SAVE'},
 'clipboard_paste':{'args':{'window':'str','expected_sha256':'str'},'help':'Type reviewed clipboard text (1–500 visible characters) into exact foreground window; requires hash from clipboard_read','sensitive':True,'confirmation':'CLIPBOARD PASTE'},

 'desktop_scroll':{'args':{'window':'str','direction':'str','steps':'str'},'help':'Scroll exact foreground window up/down, 1–1000 paced wheel steps','sensitive':True},
 'youtube_search':{'args':{'query':'str'},'help':'Open YouTube search results for a reviewed query in the default browser'},
 'bluetooth_on':{'args':{},'help':'Request Bluetooth radio on; requires local power/radio consent and Windows permission','sensitive':True,'confirmation':'BLUETOOTH ON'},
 'bluetooth_off':{'args':{},'help':'Request Bluetooth off; Bluetooth keyboard/mouse may disconnect','sensitive':True,'confirmation':'BLUETOOTH OFF'},

 'list_apps':{'args':{},'help':'List installed current-user Start application names, up to 500'},
 'list_windows':{'args':{},'help':'List visible window titles only','sensitive':True},
 'close_window':{'args':{'window':'str'},'help':'Request normal close of one exact unique window title, preserve save dialogs','sensitive':True},
 'focus_window':{'args':{'window':'str'},'help':'Restore and focus an exact unique visible window title','sensitive':True},
 'minimize_window':{'args':{'window':'str'},'help':'Minimize an exact unique visible window title','sensitive':True},
 'maximize_window':{'args':{'window':'str'},'help':'Maximize an exact unique visible window title','sensitive':True},
 'copy_path':{'args':{'folder':'str','path':'str','new_path':'str'},'help':'Copy file/folder within shared root, no overwrite, max 100 MB/2000 entries','sensitive':True},

 'volume_control':{'args':{'action':'str'},'help':'System volume up/down or mute toggle','sensitive':True},
 'set_brightness':{'args':{'percent':'str'},'help':'Set supported laptop display brightness, 10–100 percent','sensitive':True},
 'take_screenshot':{'args':{'folder':'str','path':'str'},'help':'Save primary-screen screenshot as a new PNG in a shared folder; no image uploaded','sensitive':True,'confirmation':'SCREENSHOT','label':'Capture screen'},
 'move_path':{'args':{'folder':'str','path':'str','new_path':'str'},'help':'Move or rename a file/folder within its shared root, no overwrite, max 100 MB/2000 entries','sensitive':True},
 'delete_path':{'args':{'folder':'str','path':'str'},'help':'Delete a file/folder by moving it to .saras-recovery within the same shared root, max 100 MB/2000 entries','sensitive':True,'confirmation':'DELETE','label':'Recoverable delete'},
 'search_tree':{'args':{'folder':'str','path':'str','query':'str'},'help':'Recursive filename search in a shared folder, capped at 5000 entries/3 seconds/100 matches'},

 'desktop_close':{'args':{'window':'str'},'help':'Request normal close of the exact foreground window; preserve save prompts, never force kill','sensitive':True},
 'inspect_desktop':{'args':{},'help':'Read foreground window title, primary screen size and pointer coordinates; no screenshot/content','sensitive':True},
 'desktop_type':{'args':{'window':'str','text':'str'},'help':'Type up to 500 visible characters into the exact foreground window; no focus switching','sensitive':True},
 'desktop_key':{'args':{'window':'str','key':'str'},'help':'Press enter/tab/escape/backspace/arrows/home/end in exact foreground window','sensitive':True},
 'desktop_click':{'args':{'window':'str','x':'str','y':'str'},'help':'Single left click at primary-screen coordinates in exact foreground window','sensitive':True},
 'shutdown_pc': {'args':{},'help':'Shut down this PC after a cancellable 30-second grace period; unsaved work may block shutdown','sensitive':True,'confirmation':'BAND','label':'Laptop shutdown'},
 'restart_pc': {'args':{},'help':'Restart this PC after a cancellable 30-second grace period','sensitive':True,'confirmation':'RESTART','label':'Laptop restart'},
 'cancel_shutdown': {'args':{},'help':'Cancel a SARAS shutdown/restart countdown'},
 'wifi_off': {'args':{},'help':'Request Wi-Fi radio off using Windows radio permission; remote connection may be lost','sensitive':True,'confirmation':'WIFI OFF','label':'Wi-Fi off'},
 'wifi_on': {'args':{},'help':'Request Wi-Fi radio on using Windows permission; use the laptop locally if disconnected','sensitive':True,'confirmation':'WIFI ON','label':'Wi-Fi on'},

 'status': {'args': {}, 'help': 'Read OS status'},
 'list_notes': {'args': {}, 'help': 'List SARAS notes'},
 'write_note': {'args': {'name':'str','text':'str'}, 'help': 'Create a new note; no overwrites'},
 'list_files': {'args': {'folder':'str','path':'str'}, 'help': 'List a user-shared directory'},
 'read_file': {'args': {'folder':'str','path':'str'}, 'help': 'Read a text file and its sha256'},
 'verify_file': {'args':{'folder':'str','path':'str','expected_sha256':'str'},'help':'Read a shared text file and fail unless its exact UTF-8 bytes match the approved SHA256; no file content returned'},
 'create_file': {'args': {'folder':'str','path':'str','text':'str'}, 'help': 'Create a text/code file without overwriting'},
 'replace_file': {'args': {'folder':'str','path':'str','text':'str','expected_sha256':'str'}, 'help': 'Replace an existing text file only if its hash matches; preserve backup', 'sensitive':True},
 'make_folder': {'args': {'folder':'str','path':'str'}, 'help': 'Create a folder inside a shared directory'},
 'rename_file': {'args': {'folder':'str','path':'str','new_path':'str'}, 'help': 'Rename a file without overwriting', 'sensitive':True},
 'trash_file': {'args': {'folder':'str','path':'str'}, 'help': 'Move a file to SARAS recovery folder; no permanent deletion', 'sensitive':True},
 'open_app': {'args': {'app':'str'}, 'help': 'Open calculator, notepad, paint, explorer, task_manager, vscode, chrome or edge; or an exact installed name from list_apps'},
 'open_folder': {'args':{'folder':'str','path':'str'},'help':'Open an explicitly shared directory in Windows Explorer'},
 'file_info': {'args':{'folder':'str','path':'str'},'help':'Get text file size, last-modified time and current sha256'},
 'copy_file': {'args':{'folder':'str','path':'str','new_path':'str'},'help':'Copy a text/code file within the same shared folder; never overwrite'},
 'search_files': {'args':{'folder':'str','path':'str','query':'str'},'help':'Find filenames in one shared directory (not recursive); does not read contents'},
 'open_url': {'args': {'url':'str'}, 'help': 'Open an external HTTPS website in the default browser'},
}

def validate(tool,args):
    if tool not in SPECS or not isinstance(args,dict): raise ValueError('Unsupported PC action')
    fields=SPECS[tool]['args']
    if set(args)!=set(fields): raise ValueError('Action arguments must exactly match: '+', '.join(fields))
    if any(not isinstance(v,str) or len(v)>12000 for v in args.values()): raise ValueError('Arguments must be short text')
    if tool.startswith('desktop_'):
        validate_desktop_input(tool,args)
    return args

def description(): return json.dumps(SPECS)


DESKTOP_KEYS={'enter','tab','escape','backspace','left','up','right','down','home','end','pageup','pagedown'}
def validate_desktop_input(tool,args):
    if not args.get('window','').strip() or len(args['window'])>200:raise ValueError('Provide the exact visible window title (maximum 200 characters)')
    if tool=='desktop_type':
        if not args['text'] or len(args['text'])>500 or any(ord(c)<32 or 127<=ord(c)<=159 for c in args['text']):raise ValueError('Type 1–500 visible characters; use a separate key action for Enter/Tab')
    elif tool=='desktop_key':
        if args['key'] not in DESKTOP_KEYS:raise ValueError('Choose a listed navigation key')
    elif tool=='desktop_click':
        for name in ('x','y'):
            if not args[name].isascii() or not args[name].isdigit() or len(args[name])>5:raise ValueError('Use nonnegative screen coordinates')
    elif tool=='desktop_scroll_start':
        if args['direction'] not in {'up','down'}:raise ValueError('Scroll up or down')
    elif tool=='desktop_scroll':
        if args['direction'] not in {'up','down'} or not args['steps'].isascii() or not args['steps'].isdigit() or not 1<=int(args['steps'])<=1000:raise ValueError('Scroll up/down with 1–1000 steps')
    elif tool!='desktop_close':raise ValueError('Unknown desktop action')

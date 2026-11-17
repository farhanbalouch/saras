(function(){
const $=id=>document.getElementById(id),base=location.pathname.match(/^\/account\/[0-9a-f]{32}/)?.[0]||'';
$('aiOwnerSettings').hidden=!!base;
function status(text,state){$('aiConfigStatus').textContent=text;$('aiConfigStatus').dataset.state=state}
function payload(){return {provider:$('aiProvider').value,key:$('aiKey').value,model:$('aiModelManual').value.trim()||$('aiModel').value}}
async function call(action,data={}){return SarasNetwork.json(base+'/api/ai/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})}
async function run(button,label,work){if(button.disabled)return;const old=button.textContent;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=label;status(label,'loading');try{await work()}catch(error){status(error.message,'error')}finally{button.disabled=false;button.removeAttribute('aria-busy');button.textContent=old}}
async function show(){const result=await call('status');if(result.error)throw Error(result.error);const rows=result.providers.map(p=>p.provider+' → '+p.model+' ('+(p.key_saved?'key saved privately':'environment key')+')');status(rows.length?'Active: '+result.active+'\n'+rows.join('\n'):'AI not configured. Paste a provider key privately, load models, select one and save.','success');return result}
$('aiStatus').onclick=()=>run($('aiStatus'),'Checking AI…',show);
$('aiProvider').onchange=()=>{$('aiKey').value='';$('aiModel').replaceChildren(new Option('Load this provider’s models',''));$('aiModelManual').value='';status('Selected provider changed. Its own saved key will be used if you leave the key blank.','loading')};
$('aiModels').onclick=()=>run($('aiModels'),'Loading models…',async()=>{const result=await call('models',payload());$('aiModel').replaceChildren(new Option('Choose a model',''));for(const model of result.models)$('aiModel').add(new Option(model,model));status(result.models.length+' models loaded. Model availability does not guarantee free quota.','success')});
$('aiConfigForm').onsubmit=event=>{event.preventDefault();run($('aiSave'),'Saving encrypted settings…',async()=>{if(!$('aiSaveConsent').checked)throw Error('Confirm encrypted saving first');await call('save',{...payload(),confirmed:true});$('aiKey').value='';await show();if(typeof refresh==='function')await refresh()})};
$('aiTest').onclick=()=>run($('aiTest'),'Testing provider…',async()=>{const result=await call('test',payload());status(result.message,'success')});
})();

(function(){
let proposal=null;const $=id=>document.getElementById(id),base=location.pathname.match(/^\/account\/[0-9a-f]{32}/)?.[0]||'';
async function request(path,data={}){return SarasNetwork.json(base+'/api/workflow/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})}
async function busy(button,text,fn){const old=button.textContent;button.disabled=true;button.textContent=text;$('workflowStatus').textContent=text;$('workflowStatus').dataset.state='loading';try{await fn();$('workflowStatus').dataset.state='success'}catch(error){$('workflowStatus').textContent=error.message;$('workflowStatus').dataset.state='error'}finally{button.disabled=false;button.textContent=old}}
$('workflowForm').onsubmit=event=>{event.preventDefault();busy($('workflowPrepare'),'Preparing workflow…',async()=>{proposal=null;$('workflowReview').hidden=true;const result=await request('plan',{text:$('workflowRequest').value});if(!result.steps.length)throw Error(result.explanation);proposal=result;$('workflowSteps').textContent=result.explanation+'\n\n'+result.steps.map((s,i)=>(i+1)+'. '+s.tool+' '+JSON.stringify(s.args)).join('\n');$('workflowReview').hidden=false;$('workflowStatus').textContent=(result.planner==='local'?'Fast local understanding. ':'AI plan. ')+'Review all steps. Nothing has executed yet; approval expires after 5 minutes.'})};
$('workflowApprove').onclick=()=>busy($('workflowApprove'),'Sending approved workflow…',async()=>{if(!proposal)throw Error('Prepare a workflow first');if(!confirm('Approve every listed step? They run in order; completed changes are not automatically rolled back.')){$('workflowStatus').textContent='Cancelled.';return}const result=await request('approve',{plan_id:proposal.plan_id,confirmed:true});proposal=null;$('workflowReview').hidden=true;$('workflowStatus').textContent='Approved '+result.command_ids.length+' steps. Follow the execution log. Failure or emergency stop cancels remaining steps.'});
$('workflowCancel').onclick=()=>{proposal=null;$('workflowReview').hidden=true;$('workflowStatus').textContent='Proposal cancelled; no steps sent.'};
globalThis.SarasTaskProgress={render(tasks){
 const host=$('agentTasks');if(!host)return;host.replaceChildren();
 for(const task of tasks||[]){
  const card=document.createElement('div');card.className='item command-log '+(task.status==='completed'?'success':/failed|cancelled/.test(task.status)?'error':'pending');
  const summary=document.createElement('p');summary.textContent='Task '+task.id.slice(0,8)+' • '+task.completed+'/'+task.total+' completed • '+task.status;card.append(summary);
  const progress=document.createElement('progress');progress.max=task.total;progress.value=task.completed;progress.setAttribute('aria-label','Completed steps');card.append(progress);
  for(const step of task.steps){const line=document.createElement('p');line.textContent=(step.position+1)+'. '+step.tool+' — '+step.status;card.append(line)}
  if(['queued','running'].includes(task.status)){const stop=document.createElement('button');stop.type='button';stop.textContent='Stop remaining steps';stop.onclick=()=>busy(stop,'Stopping task…',async()=>{if(!confirm('Stop pending steps? Already completed work stays; a running action may finish.'))return;const result=await request('cancel',{id:task.id,confirmed:true});$('workflowStatus').textContent=result.message;if(typeof refresh==='function')await refresh()});card.append(stop)}
  host.append(card);
 }
}};
})();

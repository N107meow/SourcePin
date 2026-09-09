import { startInspector, type Controller } from './controller';
import { createExtensionPlatform } from './extension/platform';
import asset from './assets/robot.svg';
declare global { interface Window { __sourcepin?: Controller } }

if(window.__sourcepin){window.__sourcepin.destroy();delete window.__sourcepin;}
else {
  const pending: Controller={destroy(){cancelled=true;},download(){}};let cancelled=false;
  let owner: Controller=pending;
  window.__sourcepin=pending;
  const message=(value:{type?:string})=>{if(value.type==='download-command')window.__sourcepin?.download();};
  void startInspector(createExtensionPlatform(),asset,()=>{if(window.__sourcepin===owner)delete window.__sourcepin;chrome.runtime.onMessage.removeListener(message);}).then(controller=>{
    if(cancelled){controller.destroy();return;}
    owner=controller;window.__sourcepin=controller;
    chrome.runtime.onMessage.addListener(message);
  }).catch(()=>{if(window.__sourcepin===owner)delete window.__sourcepin;});
}

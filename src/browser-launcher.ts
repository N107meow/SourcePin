import { startInspector, type Controller } from './controller';
import { createBrowserPlatform } from './platform/browser';
import { installFavicon } from './platform/favicon';
import asset from './assets/robot.svg';

export function launchBrowserInspector(kind: 'bookmarklet' | 'demo') {
  // Give the bookmark entry its own icon before the console opens, because
  // Chrome records the page icon when the bookmark runs.
  installFavicon();
  if(window.__sourcepin){window.__sourcepin.destroy();delete window.__sourcepin;}
  else {
    let cancelled=false;
    const pending: Controller={destroy(){cancelled=true;},download(){}};window.__sourcepin=pending;
    let owner: Controller=pending;
    void startInspector(createBrowserPlatform(kind),asset,()=>{if(window.__sourcepin===owner)delete window.__sourcepin;}).then(controller=>{
      if(cancelled){controller.destroy();return;}
      owner=controller;window.__sourcepin=controller;
    }).catch(()=>{if(window.__sourcepin===owner)delete window.__sourcepin;});
  }
}

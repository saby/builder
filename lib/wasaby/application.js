/**
 * @author Kolbeshin F.A.
 */
'use strict';

let appInit;

class Application {
   constructor() {
      this.requestConfig = {
         servicesPath: null,
         resourceRoot: null,
         metaRoot: null,
         application: '',
         RUMEnabled: null,
         pageName: null,
         appRoot: null,
         wsRoot: null,
         product: null
      };
   }

   // eslint-disable-next-line class-methods-use-this
   init() {
      if (!appInit) {
         appInit = global.requirejs('Application/Initializer');
         appInit.default();
      }

      return appInit;
   }

   setRequestConfig(serviceConfig) {
      /**
       * In case of presentation service usage in current project set wsConfig common parameters
       * with special placeholder to be replaced by PS afterwards. Otherwise default meta with
       * application (configured in builder by gulp_config - applicationForRebase) will be used
       */
      if (!this.requestConfig.appRoot) {
         const applicationResourcesUrl = `${serviceConfig.application}${serviceConfig.resourcesUrl || ''}`;

         this.requestConfig = {
            servicesPath: serviceConfig.multiService ? '%{SERVICES_PATH}' : serviceConfig.servicesPath,
            resourceRoot: serviceConfig.multiService ? '%{RESOURCE_ROOT}' : applicationResourcesUrl,
            metaRoot: serviceConfig.multiService ? '%{META_ROOT}' : applicationResourcesUrl,
            application: '',
            RUMEnabled: serviceConfig.multiService ? '%{RUM_ENABLED}' : 'false',
            pageName: serviceConfig.multiService ? '%{PAGE_NAME}' : '',
            appRoot: serviceConfig.multiService ? '%{APPLICATION_ROOT}' : serviceConfig.application,
            wsRoot: serviceConfig.multiService ? '%{WI.SBIS_ROOT}' : `${applicationResourcesUrl}WS.Core/`,
            product: null
         };
      }
   }

   startRequest(module, callback) {
      return new Promise((resolve, reject) => {
         global.requirejs(['Application/State', 'UI/State', module], (AppState, UIState, reqModule) => {
            const fakeReq = { };
            const fakeRes = { };
            try {
               appInit.startRequest(
                  this.requestConfig,
                  new AppState.StateReceiver(UIState.Serializer),
                  () => fakeReq,
                  () => fakeRes
               );

               const result = callback(reqModule);

               if (result instanceof Promise) {
                  // eslint-disable-next-line promise/prefer-await-to-then
                  result.then(resolve).catch(reject);

                  return;
               }

               resolve(result);
            } catch (error) {
               reject(error);
            }
         }, reject);
      });
   }
}

module.exports = Application;

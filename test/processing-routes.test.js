'use strict';

require('./init-test');

const prepareToSave = require('../lib/processing-routes');

describe('processing routes.js', () => {
   describe('prepare to save', () => {
      it('routes info is empty', () => {
         const routesInfo = {};
         const jsModules = [];
         prepareToSave(routesInfo, jsModules);
         Object.getOwnPropertyNames(routesInfo).length.should.equal(0);
      });
      it('controller exist', () => {
         const routesInfo = {
            'resources/Test.routes.js': {
               '/test.html': {
                  controller: 'js!SBIS3.Test'
               }
            }
         };
         const jsModules = ['SBIS3.Test'];
         prepareToSave(routesInfo, jsModules);
         routesInfo['resources/Test.routes.js']['/test.html'].isMasterPage.should.equal(false);
      });
      it('controller not exist', () => {
         const routesInfo = {
            'resources/Test.routes.js': {
               '/test.html': {
                  controller: 'js!SBIS3.Test'
               }
            }
         };
         const jsModules = [];
         prepareToSave(routesInfo, jsModules);
         routesInfo['resources/Test.routes.js']['/test.html'].isMasterPage.should.equal(false);
      });
   });
});

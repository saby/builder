'use strict';

const plumber = require('gulp-plumber');
const getBuildStatusStorage = require('../classes/build-status');
const logger = require('../../../lib/logger').logger();

module.exports = function declarePlugin(taskName, taskParameters, moduleInfo) {
   return plumber({
      errorHandler(error) {
         taskParameters.cache.markCacheAsFailed();
         getBuildStatusStorage().registerFailedModule(moduleInfo);

         logger.error({
            message: `Task ${taskName} was completed with error`,
            error,
            moduleInfo
         });

         this.emit('end');
      }
   });
};

'use strict';

const logger = require('../../../lib/logger').logger();
const fs = require('fs-extra');
const { path, toPosix } = require('../../../lib/platform/path');

let hooks = null;

/**
 * Получить текущую рабочую директорию процесса в POSIX формате.
 * @returns {string} Текущая рабочая директория процесса в POSIX формате.
 */
function cwd() {
   return toPosix(process.cwd());
}

class Hooks {
   constructor() {
      this.executedHooks = {};
      this.hooks = {};
   }

   init(hooksPath) {
      try {
         // eslint-disable-next-line global-require
         this.hooks = require(hooksPath);
      } catch (err) {
         this.hooks = {};
      }
   }

   addExecutedHook(hookName, args) {
      if (!this.executedHooks[hookName]) {
         this.executedHooks[hookName] = [];
      }
      this.executedHooks[hookName].push({
         type: args[0],
         reason: args[1]
      });
   }

   /**
    * execute transmitted hook
    * returns needed hook function if hook is presented
    * in hooks API, otherwise logs 404 warning message
    * @param {String} hookName hook name to execute
    * @param {Array} args hook function arguments to transmit through
    * @returns {Promise<void>}
    */
   async executeHook(hookName, args) {
      if (this.hooks[hookName]) {
         try {
            await this.hooks[hookName](...args);
            this.addExecutedHook(hookName, args);
            logger.info(`hook ${hookName} executed successfully!`);
         } catch (error) {
            logger.warning({
               message: `Error during execution of hook "${hookName}"`,
               error
            });
         }
         return;
      }
      logger.info(`Hook with name "${hookName}" isn't found! Check your hooks API for this one.`);
   }

   saveExecutedHooks(logFolder) {
      const resultPath = logFolder || cwd();
      fs.outputJsonSync(path.join(resultPath, 'executed-hooks.json'), this.executedHooks);
   }
}

module.exports = {
   hooks() {
      if (!hooks) {
         hooks = new Hooks();
      }

      return hooks;
   }
};

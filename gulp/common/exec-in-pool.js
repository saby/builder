/**
 * @author Kolbeshin F.A.
 */

'use strict';

const logger = require('../../lib/logger').logger();

/**
 * Execute function in worker's pool with timeout(6 minutes seconds by default)
 * Also prepare data for correct transport of logs into gulp main process out of
 * worker's pool.
 * @param {Pool} pool - worker's pool
 * @param {string} funcName - function to be executed in current worker's pool.
 * @param {Array} funcArgs - arguments of function to be executed in current worker's pool.
 * @param {string} filePath - full path of current processing file. Needed by logger.
 * @param {ModuleInfo} moduleInfo - full information about current interface module. Needed by logger.
 * @param {Number} workerTimeout - timeout for function execution.
 * @returns {Promise<[error, result]>}
 */
async function execInPool(pool, funcName, funcArgs, filePath = '', moduleInfo = null, workerTimeout = 300000) {
   try {
      let moduleInfoObj;
      if (moduleInfo) {
         moduleInfoObj = {
            name: moduleInfo.name,
            responsible: moduleInfo.responsible,
            nameWithResponsible: moduleInfo.nameWithResponsible
         };
      }
      const [error, result, messagesForReport] = await pool
         .exec(funcName, [funcArgs, filePath, moduleInfoObj])
         .timeout(workerTimeout);
      logger.addMessagesFromWorker(messagesForReport);

      /**
       * Throw Gulp main process down if require error occurred to avoid logs hell of single-type messages
       * about require errors. P.S. will be correctly caught by NodeJS process post-processing function
       * in the end of gulp main process.
        */
      if (error && error.message.includes('node\'s require')) {
         logger.error(error.stack);
         process.exit(1);
      }
      return [error, result];
   } catch (error) {
      return [error, null];
   }
}
module.exports = execInPool;

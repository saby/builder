'use strict';

const fs = require('fs-extra');
const { path, toPlatform } = require('../../../../lib/platform/path');
const { isWindows, TOTAL_MEMORY } = require('../../../../lib/builder-constants');
const getBuildStatusStorage = require('../../../common/classes/build-status');
const logger = require('../../../../lib/logger').logger();
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const hooks = require('../../../common/classes/hooks').hooks();

async function getTypeScriptCache(taskParameters) {
   if (taskParameters.config.tscCache) {
      const { tscCachePath } = taskParameters.config;

      if (!(await fs.pathExists(tscCachePath))) {
         const reason = `Кеш tsc текущего набора модулей "${tscCachePath}" не найден. Выполняем tsc с нуля`;
         logger.info(reason);
         taskParameters.cache.dropCacheForTsc = true;

         // push tsc cache absence only if cache isn't dropped already
         if (!getBuildStatusStorage().cacheIsDropped) {
            await hooks.executeHook('dropCacheHook', ['tsc', reason]);
         }
      } else {
         logger.debug(`Using typescript cache ${tscCachePath}`);
      }

      return ` --incremental --tsBuildInfoFile "${tscCachePath}"`;
   }

   return '';
}

function execTsc(taskParameters, logFile) {
   return async function compileTypescript() {
      const sourceDirectory = taskParameters.config.sourcesDirectory;
      const processOptions = {
         maxBuffer: 1024 * 500,
         cwd: sourceDirectory
      };

      // process.getegid is not available on windows or android, set it only for nix systems
      if (process.getegid) {
         processOptions.gid = process.getegid();
         processOptions.uid = process.geteuid();
      }

      /**
       * Add command for specifying additional memory for tsc compiler. Full online-inside
       * project(at the right moment) contains approximately  32737 typescript errors. To
       * log all this mess, tsc compiler uses more than default node js process memory(1.5 gb)
       */
      let heapSizeCommand;
      const allowedMemory = Math.trunc(TOTAL_MEMORY * 0.5);
      if (isWindows) {
         heapSizeCommand = `set NODE_OPTIONS="--max-old-space-size=${allowedMemory}"`;
      } else {
         heapSizeCommand = `export NODE_OPTIONS='--max-old-space-size=${allowedMemory}'`;
      }

      const cliPath = path.join(taskParameters.sabyTypescriptDir, 'cli.js');

      let tscFlags = ` --project "${taskParameters.typescriptConfigPath}"`;

      tscFlags += await getTypeScriptCache(taskParameters);

      try {
         await fs.outputFile(logFile, '');
         const execCommand = (
            `${heapSizeCommand} && ` +
            `node "${toPlatform(cliPath)}" --compiler ${tscFlags} ` +
            `>> "${toPlatform(logFile)}"`
         );

         await exec(execCommand, processOptions);
      } catch (error) {
         const logFileContent = await fs.readFile(logFile, 'utf8');
         const result = logFileContent.split('\n').filter(currentError => !!currentError);

         // log critical error with it's stack if there is no ts errors in current log file
         if (result.length === 0 || !logFileContent.includes('error TS')) {
            const reason = `typescript execution error is occurred. Something has happened during tsc compilation ${error && error.message}`;
            logger.error({
               message: reason,
               error
            });
            await hooks.executeHook('dropCacheHook', ['tsc', reason]);
            throw new Error(reason);
         }
      }
   };
}

module.exports = execTsc;

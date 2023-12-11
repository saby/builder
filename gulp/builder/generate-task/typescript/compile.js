'use strict';

const fs = require('fs-extra');
const { path, toPlatform } = require('../../../../lib/platform/path');
const getBuildStatusStorage = require('../../../common/classes/build-status');
const logger = require('../../../../lib/logger').logger();
const { getHeapSizeCommand } = require('../../../../lib/helpers');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const hooks = require('../../../common/classes/hooks').hooks();

async function getTypeScriptExtraFlags(taskParameters, logFile) {
   let tscFlags = '';
   if (taskParameters.config.tscCache) {
      const { tscCachePath } = taskParameters.config;

      if (!(await fs.pathExists(tscCachePath))) {
         const reason = `Кеш tsc текущего набора модулей "${tscCachePath}" не найден. Выполняем tsc с нуля`;
         logger.info(reason);
         taskParameters.cache.dropCacheForTsc = true;

         // push tsc cache absence only if cache isn't dropped already
         if (!getBuildStatusStorage().cacheIsDropped && !taskParameters.cache.dropCacheForTsc) {
            await hooks.executeHook('dropCacheHook', ['tsc', reason]);
         }
      } else {
         logger.debug(`Using typescript cache ${tscCachePath}`);
      }

      const isDisabledCache = process.env.DISABLE_TSC_CACHE;

      // Нам нужно иметь возможность через переменную окружения выключать кэш tsc для проведения
      // исследования
      if (!isDisabledCache) {
         tscFlags += ` --incremental --tsBuildInfoFile "${tscCachePath}"`;
      }
   }

   // по отдельному флагу включаем доп. диагностику для подробного анализа работы tsc компилятора.
   const isTraceEnabled = process.env.ENABLE_TSC_TRACE;
   if (isTraceEnabled) {
      tscFlags += ` --extendedDiagnostics --generateCpuProfile "${path.dirname(logFile)}/tsc_compiler.cpuprofile"` +
      ` --generateTrace "${path.dirname(logFile)}/tracing_output_folder"`;
   }

   return tscFlags;
}

function execTsc(taskParameters, logFile) {
   return async function compileTypescript() {
      if (!taskParameters.config.typescriptChanged && !taskParameters.cache.isFirstBuild()) {
         return;
      }

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

      // Add command for specifying additional memory for tsc compiler. Full online-inside
      // project(at the right moment) contains approximately  32737 typescript errors. To
      // log all this mess, tsc compiler uses more than default node js process memory(1.5 gb)
      const heapSizeCommand = getHeapSizeCommand();
      const cliPath = path.join(taskParameters.sabyTypescriptDir, 'cli.js');

      let tscFlags = ` --project "${taskParameters.typescriptConfigPath}"`;

      tscFlags += await getTypeScriptExtraFlags(taskParameters, logFile);

      try {
         await fs.outputFile(logFile, '');
         const execCommand = (
            `${heapSizeCommand} && ` +
            `node "${toPlatform(cliPath)}" --compiler ${tscFlags} ` +
            `>> "${toPlatform(logFile)}"`
         );

         logger.debug(`Executing tsc compiler with command: "${execCommand}"`);

         await exec(execCommand, processOptions);
      } catch (error) {
         const logFileContent = await fs.readFile(logFile, 'utf8');
         const result = logFileContent.split('\n').filter(currentError => !!currentError);

         // если включена доп. диагностика, нужно сохранить из общего лога полезную инфу об обработанном ts-коде
         // в отдельный лог для более удобного анализа
         if (process.env.ENABLE_TSC_TRACE) {
            const tscResultInfo = logFileContent.slice(logFileContent.indexOf('Files:  '), logFileContent.length);
            await fs.outputFile(`${path.dirname(logFile)}/tsc-work-report.txt`, tscResultInfo);
         }

         // log critical error with its stack if there is no ts errors in current log file
         if (result.length === 0 || !logFileContent.includes('error TS')) {
            const reason = `typescript execution error is occurred. Something has happened during tsc compilation ${error && error.message}`;
            logger.error({
               message: reason,
               error
            });

            throw new Error(reason);
         }
      }
   };
}

module.exports = execTsc;

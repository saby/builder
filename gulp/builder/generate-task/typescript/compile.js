'use strict';

const fs = require('fs-extra');
const {
   path,
   toPlatform
} = require('../../../../lib/platform/path');
const getBuildStatusStorage = require('../../../common/classes/build-status');
const logger = require('../../../../lib/logger')
   .logger();
const { getHalfMemoryLimit } = require('../../../../lib/helpers');
const { spawn } = require('child_process');
const hooks = require('../../../common/classes/hooks')
   .hooks();

async function checkForTscCache(taskParameters) {
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
   }
}

function promiseExecTsc(taskParameters, logFiles) {
   const { tscCompileError, logFile } = logFiles;
   return new Promise((resolve) => {
      const { tscDirectory } = taskParameters.config;
      const processOptions = {
         maxBuffer: 1024 * 500,
         cwd: tscDirectory
      };

      // process.getegid is not available on windows or android, set it only for nix systems
      if (process.getegid) {
         processOptions.gid = process.getegid();
         processOptions.uid = process.geteuid();
      }

      const cliPath = path.join(taskParameters.sabyTypescriptDir, 'cli.js');
      const tscArguments = [
         toPlatform(cliPath),
         '--compiler',
         '--project',
         taskParameters.typescriptConfigPath
      ];

      // Add command for specifying additional memory for tsc compiler. Full online-inside
      // project(at the right moment) contains approximately  32737 typescript errors. To
      // log all this mess, tsc compiler uses more than default node js process memory(1.5 gb)
      const heapSizeCommand = ` --max-old-space-size=${getHalfMemoryLimit()}`;
      const outputErrStream = fs.createWriteStream(tscCompileError);
      const outputStream = fs.createWriteStream(logFile);

      const isDisabledCache = process.env.DISABLE_TSC_CACHE;

      // Нам нужно иметь возможность через переменную окружения выключать кэш tsc для проведения
      // исследования
      if (!isDisabledCache) {
         tscArguments.push('--incremental', '--tsBuildInfoFile', taskParameters.config.tscCachePath);
      }

      // по отдельному флагу включаем доп. диагностику для подробного анализа работы tsc компилятора.
      const isTraceEnabled = process.env.ENABLE_TSC_TRACE;
      if (isTraceEnabled) {
         tscArguments.push(
            '--extendedDiagnostics',
            '--generateCpuProfile',
            `${path.dirname(logFile)}/tsc_compiler.cpuprofile`,
            '--generateTrace',
            `${path.dirname(logFile)}/tracing_output_folder`
         );
      }

      const NODE_OPTIONS = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ${heapSizeCommand}` : heapSizeCommand;
      logger.info(`running tsc compiler with max-old-space-size="${getHalfMemoryLimit()}" and arguments: node ${tscArguments.join(' ')}.`);
      const ls = spawn(
         'node',
         tscArguments,
         {
            ...processOptions,
            env: { ...process.env, NODE_OPTIONS }
         }
      );
      ls.stdout.pipe(outputStream);
      ls.stderr.pipe(outputErrStream);

      ls.on('exit', (code) => {
         logger.info(`tsc spawn exited with exit code ${code}`);
         resolve(code);
      });
   });
}

function execTsc(taskParameters, logFile) {
   return async function compileTypescript() {
      if (!taskParameters.config.typescriptChanged && !taskParameters.cache.isFirstBuild()) {
         return;
      }

      await checkForTscCache(taskParameters, logFile);
      await fs.outputFile(logFile, '');

      // файл, в который будет сохраняться выхлоп аварийного завершения работы компилятора tsc.
      // чтобы мы могли вывести ошибку, по которой компилятор не смог завершить свою работу.
      const tscCompileError = `${path.dirname(logFile)}/tsc_errors.log`;

      const promiseResults = await Promise.all([promiseExecTsc(taskParameters, { tscCompileError, logFile })]);

      // компилятор tsc может завершиться со следующими кодами:
      // 0 - всё успешно.
      // 1 - критическая ошибка, компилятор не смог завершить свою работу
      // (например компилятор упал с Javascript Heap out of memory)
      // 2 - компилятор завершил свою работу, но с ошибками
      // поэтому нам надо обработать результат работы компилятора только в случае, если код выхода не 0
      if (promiseResults[0] !== 0) {
         const logFileContent = await fs.readFile(logFile, 'utf8');
         const result = logFileContent.split('\n')
            .filter(currentError => !!currentError);

         // если включена доп. диагностика, нужно сохранить из общего лога полезную инфу об обработанном ts-коде
         // в отдельный лог для более удобного анализа
         if (process.env.ENABLE_TSC_TRACE) {
            const tscResultInfo = logFileContent.slice(logFileContent.indexOf('Files:  '), logFileContent.length);
            await fs.outputFile(`${path.dirname(logFile)}/tsc-work-report.txt`, tscResultInfo);

            // наш tsc errors analizer не переварит выхлоп из extendedDiagnostics, поэтому после записи
            // диагностики в отдельный файл, надо удалить эту диагностику из общего выхлопа
            await fs.outputFile(logFile, logFileContent.slice(0, logFileContent.indexOf('Files:  ')));
         }

         // log critical error with its stack if there is no ts errors in current log file
         if (result.length === 0 || !logFileContent.includes('error TS')) {
            const errors = await fs.readFile(tscCompileError, 'utf8');
            const reason = `typescript execution error is occurred. Something has happened during tsc compilation ${errors}`;
            logger.error({
               message: reason
            });

            throw new Error(reason);
         }
      }
   };
}

module.exports = execTsc;

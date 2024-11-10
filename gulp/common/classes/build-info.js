/**
 * Класс, предоставляющий информацию о текущей сборке и состоянии кеша, который удерживается запущенным процессом.
 * Данные о сборке сохраняются в lockfile, с помощью которого проверяется возможность использования директории кеша
 * и переиспользования его данных.
 * Необходимо для предотвращения ситуаций, когда несколько процессов попытаются запуститься на одном кеше одновременно.
 *
 * @author Krylov M.A.
 */

'use strict';

let globalBuildInfo;

const fs = require('fs-extra');

const { path } = require('../../../lib/platform/path');
const logger = require('../../../lib/logger').logger();

const LOCKFILE_NAME = 'build.lockfile';

const CacheState = {
   UNKNOWN: 'UNKNOWN',
   PENDING: 'PENDING',
   PASSED: 'PASSED',
   FAILED: 'FAILED'
};

function outputBuildInfoSync(buildInfo) {
   return fs.outputJsonSync(buildInfo.filePath, {
      processID: buildInfo.processID,
      cacheState: buildInfo.cacheState
   });
}

class BuildInfo {
   constructor({ processID = process.pid, cacheState = CacheState.UNKNOWN, filePath }) {
      this.filePath = filePath;
      this.processID = processID;
      this.cacheState = cacheState;
   }

   lockSync() {
      this.processID = process.pid;
      this.cacheState = CacheState.PENDING;

      outputBuildInfoSync(this);
   }

   unlockSync(cacheState = CacheState.FAILED) {
      this.cacheState = cacheState;

      outputBuildInfoSync(this);
   }

   static loadSync(dirPath) {
      const filePath = path.join(dirPath, LOCKFILE_NAME);

      if (fs.existsSync(filePath)) {
         const buildInfo = fs.readJsonSync(filePath);

         buildInfo.filePath = filePath;

         return new BuildInfo(buildInfo);
      }

      return new BuildInfo({ filePath });
   }
}

function buildInfoExitHandler(dirPath) {
   const builderInfo = BuildInfo.loadSync(dirPath);

   if (builderInfo.cacheState === CacheState.PENDING) {
      builderInfo.cacheState = CacheState.FAILED;
   }

   outputBuildInfoSync(builderInfo);
}

function lockBuildInfo(cachePath, onLastBuildFailedCallback) {
   fs.ensureDirSync(cachePath);

   globalBuildInfo = BuildInfo.loadSync(cachePath);

   if (globalBuildInfo.cacheState === CacheState.PENDING) {
      const possiblyCriticalErrorMessage = (
         `Директория кеша "${cachePath}", возможно, используется другим процессом (pid=${globalBuildInfo.processID}), еще выполняющимся или завершившимся аварийно. ` +
         'Необходимо убедиться, что кеш используется только одним процессом.'
      );

      logger.warning(possiblyCriticalErrorMessage);
   }

   if (typeof onLastBuildFailedCallback === 'function' && globalBuildInfo.cacheState === CacheState.FAILED) {
      onLastBuildFailedCallback();
   }

   globalBuildInfo.lockSync();

   logger.debug(`File '${globalBuildInfo.filePath}' updated successfully`);
}

function unlockBuildInfo(cachePath) {
   const physicalBuildInfo = BuildInfo.loadSync(cachePath);

   if (globalBuildInfo.processID !== physicalBuildInfo.processID) {
      const errorMessage = (
         `В процессе сборки другой процесс (pid=${physicalBuildInfo.processID}) захватил и использовал директорию кеша "${cachePath}". ` +
         'Необходимо убедиться, что кеш используется только одним процессом, и перезапустить сборку - ' +
         'результат может быть невалидным.'
      );

      throw new Error(errorMessage);
   }

   if (physicalBuildInfo.cacheState === CacheState.UNKNOWN) {
      const errorMessage = (
         `В процессе сборки кто-то удалил lock-файл "${physicalBuildInfo.filePath}". ` +
         'Необходимо убедиться, что кеш используется только одним процессом, и перезапустить сборку - ' +
         'результат может быть невалидным.'
      );

      throw new Error(errorMessage);
   }

   globalBuildInfo.unlockSync(CacheState.PASSED);

   logger.debug(`File '${globalBuildInfo.filePath}' updated successfully`);
}

module.exports = {
   BuildInfo,
   CacheState,
   buildInfoExitHandler,
   lockBuildInfo,
   unlockBuildInfo
};

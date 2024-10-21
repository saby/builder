/* eslint-disable no-await-in-loop */

/**
 * Модуль, предоставляющий возможность блокировать чтение/запись к некоторому ресурсу,
 * с целью недопущения гонок при работе в параллельном режиме.
 *
 * В качестве "меток" блокировки используются директории -- методы mkdir, rmdir, которые являются атомарными.
 *
 * @author Krylov M.A.
 */

'use strict';

const ACQUIRE_ATTEMPTS = 15;
const TIMEOUT = 2000;
const DIRECTORY_NAME = 'lock-files';

const fs = require('fs-extra');

const logger = require('./logger').logger();
const { path } = require('./platform/path');

const locks = new Set();

function onExitCleaner() {
   locks.forEach((filePath) => {
      try {
         fs.rmdirSync(filePath);
      } catch (e) {
         // Do nothing
      }
   });
}

process.on('exit', onExitCleaner);

async function lock(filePath) {
   try {
      await fs.mkdir(filePath);

      locks.add(filePath);

      return true;
   } catch (error) {
      if (error.code === 'EEXIST') {
         return false;
      }

      throw error;
   }
}

async function unlock(filePath) {
   try {
      await fs.rmdir(filePath);

      return true;
   } catch (error) {
      if (error.code === 'ENOENT') {
         return false;
      }

      throw error;
   } finally {
      locks.delete(filePath);
   }
}

function sleepFor(ms) {
   return new Promise(resolve => setTimeout(() => resolve(), ms));
}

function getMaxAttempts(maxAttempts) {
   return typeof maxAttempts === 'number' && maxAttempts > 0 ? maxAttempts : ACQUIRE_ATTEMPTS;
}

function getTimeout(timeout) {
   return typeof timeout === 'number' && timeout > 0 ? timeout : TIMEOUT;
}

async function withLockfile(filePath, callback, options = {}) {
   await fs.ensureDir(path.dirname(filePath));

   const maxAttemptCount = getMaxAttempts(options.maxAttemptCount);
   const timeout = getTimeout(options.timeout);

   for (let i = 0; i < maxAttemptCount; ++i) {
      try {
         if (await lock(filePath)) {
            try {
               const result = callback();
               if (result instanceof Promise) {
                  await result;
               }
            } catch (error) {
               throw error;
            } finally {
               if (!(await unlock(filePath))) {
                  logger.debug(`Removed lockfile "${filePath}" with error`);
               }
            }

            return;
         }

         await sleepFor(timeout);
      } catch (error) {
         logger.error(`Cannot create lockfile "${filePath}": ${error.message}`);

         throw error;
      }
   }
}

let featureEnabled = false;

module.exports = (filePath, callback, options) => {
   if (featureEnabled) {
      return withLockfile(filePath, callback, options);
   }

   return callback();
};

module.exports.enableLockfileFeature = () => {
   featureEnabled = true;
   logger.debug('Using lock files for builder\'s cache');
};

module.exports.toFileName = (p, key) => path.join(p, DIRECTORY_NAME, key);

module.exports.toDirectoryPath = p => path.join(p.config.cachePath, DIRECTORY_NAME);

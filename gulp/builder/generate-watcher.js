/**
 * API for native gulp watcher.
 */
'use strict';

const logger = require('../../lib/logger').logger();
const { exec } = require('child_process');
const {
   path,
   toPlatform,
   cwd,
   toPosix
} = require('../../lib/platform/path');
const ConfigurationReader = require('../common/configuration-reader');
const processParameters = ConfigurationReader.getProcessParameters(process.argv);
const fs = require('fs-extra');
const crypto = require('crypto');

/**
 * get processed and parsed gulp config to get proper
 * absolute path to builder cache and other useful information
 * @type {{}}
 */
const gulpConfig = ConfigurationReader.readConfigFileSync(processParameters.config, cwd());
const processOptions = {
   maxBuffer: 1024 * 500,
   cwd: cwd()
};
const isReleaseMode = ((config) => {
   const packingEnabled = config.deprecatedOwnDependencies || config.customPack || config.deprecatedStaticHtml;

   // if we are getting packing task as input, minimization should be enabled
   if (packingEnabled && !config.minimize) {
      config.minimize = true;
   }

   return config.minimize || packingEnabled ? 'release' : 'debug';
})(gulpConfig);

const SOURCE_ROOT = toPosix(`${gulpConfig.cache}/temp-modules`);
const CACHE_FOLDER = toPosix(`${gulpConfig.cache}/incremental_build`);
const OUTPUT_FOLDER = toPosix(gulpConfig.output);

/**
 * constants that describes Gulp native error about not existing file with
 * a given glob-pattern of a file that was transmitted by the Gulp-watcher
 * @type {string}
 */
const REMOVED_FILE_ERROR = 'File not found with singular glob:';
const REMOVED_FILE_SUGGESTION = '(if this was purposeful, use `allowEmpty` option)';

function lockCacheSymlinks() {
   const lockFilePath = path.join(gulpConfig.cache, 'temp-modules.lockfile');

   if (fs.existsSync(lockFilePath)) {
      return;
   }

   fs.outputFileSync(lockFilePath, '', { flag: 'w+' });

   logger.info(`Created lockfile ${lockFilePath}`);

   const onExitHandler = () => {
      if (fs.existsSync(lockFilePath)) {
         fs.rmSync(lockFilePath, { force: true });
         logger.info(`Removed lockfile ${lockFilePath}`);
      }
   };

   process.on('SIGINT', onExitHandler);
   process.on('SIGQUIT', onExitHandler);
   process.on('SIGTERM', onExitHandler);
}

/**
 * Class of current build process. Stores and shows all of info
 * that current build emits.
 */
class ChildProcess {
   constructor(executor) {
      this.errors = [];
      this.warnings = [];
      this.filesToRemove = [];
      this.hasErrors = false;
      this.hasWarnings = false;
      this.executor = executor;
   }

   /**
    * Catches all of output from process to log everything that is happening
    * inside of child_process(executes gulp task to rebuild single file)
    */
   processOutputEmit() {
      this.executor.stdout.on('data', (data) => {
         const dataString = data.toString();
         logger.debug(data.toString());
         if (dataString.includes('[ERROR]')) {
            this.errors.push(dataString);
            this.hasErrors = true;
         }
         if (dataString.includes('[WARNING]')) {
            this.warnings.push(dataString);
            this.hasWarnings = true;
         }
      });
   }

   /**
    * catch all of critical errors from process that occurs inside
    * of a child_process(executes gulp task to rebuild single file)
    */
   processErrorEmit(watcherContext) {
      this.executor.stderr.on('data', (data) => {
         if (data.includes(REMOVED_FILE_ERROR)) {
            const filePath = this.addFilesToRemove(data);
            if (watcherContext.filesHash[filePath]) {
               delete watcherContext.filesHash[filePath];
            }
            logger.debug("source wasn't found because it was moved or renamed which means it has to be removed from output!");
            this.filesToRemove.forEach((currentPath) => {
               fs.removeSync(currentPath);
               logger.debug(`removed path ${currentPath}`);
            });
            this.filesToRemove = [];
            watcherContext.addFileHash = false;
         } else {
            logger.debug(data.toString());
         }
      });
   }

   /**
    * Gets full path from error and adds whole list of files belonging to the source file
    * in depend of gulp configuration(minimization, compression, etc.)
    * @param data
    */
   addFilesToRemove(data) {
      const startFilePath = data.indexOf(REMOVED_FILE_ERROR) + REMOVED_FILE_ERROR.length;
      const endFilePath = data.indexOf(REMOVED_FILE_SUGGESTION);
      const filePath = data.slice(startFilePath, endFilePath).trim();
      const prettyPath = toPosix(filePath);
      const relativePath = prettyPath.replace(SOURCE_ROOT, '');
      const extension = relativePath.split('.').pop();

      this.addPathsByExtension(
         path.join(OUTPUT_FOLDER, relativePath),
         extension
      );

      // If "distributive" flag is equal "false", output
      // folder and cache folders are equal, so we don't
      // need further processing of paths for cache folder,
      // it was already processed before
      if (isReleaseMode && gulpConfig.distributive) {
         this.addPathsByExtension(
            path.join(CACHE_FOLDER, relativePath),
            extension
         );
      }
      return filePath;
   }

   /**
    * Post processing results of single file gulp task execution.
    * Logs all errors/warning if it's occurred
    * @param resolve
    * @param reject
    */
   processSingleFileResult(watcherContext, filePath, hash) {
      this.executor.on('exit', (code, signal) => {
         if (signal === 'SIGTERM') {
            logger.info('current file build has been terminated');
         } else {
            if (this.hasErrors) {
               logger.info(`watcher: build was completed with these errors:\n${this.errors.join('\n')}`);
            }
            if (this.hasWarnings) {
               logger.info(`watcher: build was completed with these warnings:\n${this.errors.join('\n')}`);
            }
            if (!this.hasErrors) {
               logger.info(`watcher: file ${filePath} has been built successfully!`);
            }
         }

         // free up workflow for the next file in watcher build queue
         watcherContext.currentlyBuilding = false;

         // add current compiled file hash into current watcher hash list
         if (watcherContext.addFileHash) {
            watcherContext.filesHash[filePath] = hash;
         }

         // Сообщить родительскому процессу (wasaby-cli), что закончилась пересборка следующих файлов,
         // если установлено IPC соединение.
         if (process.connected) {
            process.send({ filePath });
         }

         // remove built file from current building files list.
         delete watcherContext.filesToBuild.ready[filePath];
      });
   }

   /**
    * Post processing results of common gulp task execution(build)
    * Logs all errors/warning if it's occurred
    */
   processCommonBuildResult(watcherContext) {
      this.executor.on('exit', (code, signal) => {
         if (signal === 'SIGTERM') {
            logger.info('current file build has been terminated');
         } else {
            if (this.hasErrors) {
               logger.info(`watcher: build was completed with errors. See for the errors in report ${gulpConfig.logs}`);
            }
            if (this.hasWarnings) {
               logger.info(`watcher: build was completed with warnings. See for the warnings in report ${gulpConfig.logs}`);
            }
            if (!this.hasErrors) {
               logger.info('watcher: build was completed successfully!');
            }
         }

         // free up executor for next files in queue to be built
         watcherContext.commonBuildStarted = false;
      });
   }


   // adds all paths for the given path with the given extensions to be replaced with
   addCompiledSource(filePath, from, to) {
      if (to) {
         this.filesToRemove.push(filePath.replace(from, to));
      }
      if (isReleaseMode) {
         const minifiedPath = filePath.replace(from, `.min${to || from}`);
         this.filesToRemove.push(minifiedPath);
         if (gulpConfig.compress) {
            this.filesToRemove.push(`${minifiedPath}.br`);
            this.filesToRemove.push(`${minifiedPath}.gz`);
         }
      }
   }

   // adds all paths that are belonging to the source path
   addPathsByExtension(filePath, extension) {
      this.filesToRemove.push(filePath);
      switch (extension) {
         case 'less':
            this.addCompiledSource(filePath, `.${extension}`, '.css');
            break;
         case 'ts':
         case 'tsx':
            this.addCompiledSource(filePath, `.${extension}`, '.js');
            break;
         default:
            this.addCompiledSource(filePath, `.${extension}`);
            break;
      }
   }
}

/**
 * main class for watcher function -
 * what and how to execute when there is a file to rebuild
 */
class WatcherTask {
   constructor() {
      this.filesHash = {};
      this.filesToBuild = {
         awaits: {},
         ready: {},
         newChanged: false
      };
      this.currentlyBuilding = 0;
      this.newChanged = false;
      this.commonBuildStarted = false;
   }

   reset() {
      this.filesToBuild = {
         awaits: {},
         ready: {}
      };
   }

   debounce() {
      const gulpBinPath = require.resolve('gulp/bin/gulp');

      lockCacheSymlinks();

      setInterval(() => {
         try {
            const changedFiles = Object.keys(this.filesToBuild.ready);

            /**
             * do rebuild only in case if all of changed files was caught.
             * F.e. during branch checkout there are a lot of changed files
             * and watcher needs extra time to catch them all. Better to skip
             * one watcher iteration than do rebuild after rebuild one more time
             * for all caught files during the first rebuild.
             */
            if (!this.newChanged) {
               // run files rebuild only if there is anything to rebuild
               // and common build isn't running yet
               if (changedFiles.length > 0 && !this.commonBuildStarted) {
                  if (changedFiles.length > 300) {
                     // remove all of changed files from list to catch all
                     // new changes after this common rebuild was started
                     this.reset();
                     this.commonBuildStarted = true;
                     logger.info(`there are too many files changed. Running common build in this case. Number of changed files ${changedFiles.length}`);
                     const currentExecutor = exec(
                        `node "${toPlatform(gulpBinPath)}" build --config="${toPlatform(processParameters.config)}" --symlinksExist=true --max-old-space-size=16384`,
                        processOptions
                     );
                     const buildExecutor = new ChildProcess(currentExecutor);
                     buildExecutor.processOutputEmit();
                     buildExecutor.processErrorEmit();
                     buildExecutor.processCommonBuildResult(this);
                  } else {
                     changedFiles.forEach((filePath) => {
                        let fileContent;

                        /**
                         * deleting of a file causes a critical error and watcher exits with exit
                         * code 1. This can cause a confusion - programmer deleted a file, nothing
                         * happened on Genie side, but at the same time watcher process died with critical
                         * error and no one knows about it, because Genie has functionality when builder
                         * watcher logs emits in Genie interface not in real time but with chunks
                         * of certain size, so this needs a bit of luck to catch this kind of an exception
                         * in Gulp's logs of Genie interface.
                         */
                        try {
                           fileContent = fs.readFileSync(filePath, 'utf8');
                        } catch (err) {
                           logger.info(`watcher: file ${filePath} was removed!`);
                        }
                        const hash = fileContent ? crypto.createHash('sha1').update(fileContent).digest('base64') : '';
                        if (this.filesHash[filePath] !== hash) {
                           // build only 1 file in a row to avoid CPU and memory overflow, also to avoid multiple
                           // parallel attempts to save builder cache into json, so it wouldn't cause further errors
                           // such as json parse errors
                           if (!this.currentlyBuilding) {
                              this.currentlyBuilding = true;
                              this.addFileHash = true;
                              logger.info(`watcher: start file ${filePath} build!`);
                              const hotReloadFlag = processParameters.hotReloadPort ? `--hotReloadPort="${processParameters.hotReloadPort}"` : '';
                              const currentExecutor = exec(
                                 `node "${toPlatform(gulpBinPath)}" buildOnChange --config="${toPlatform(processParameters.config)}" --symlinksExist=true --filePath="${filePath}" ${hotReloadFlag}`,
                                 processOptions
                              );
                              const fileExecutor = new ChildProcess(currentExecutor);
                              fileExecutor.processOutputEmit();
                              fileExecutor.processErrorEmit(this);
                              fileExecutor.processSingleFileResult(this, filePath, hash);
                           }
                        } else {
                           logger.info(`File ${filePath} has already been built. False watcher trigger.`);

                           // remove built file from current building files list.
                           delete this.filesToBuild.ready[filePath];
                        }
                     });
                  }
               } else {
                  const awaitingFiles = Object.keys(this.filesToBuild.awaits);
                  if (awaitingFiles.length > 0) {
                     logger.info('There are some files awaiting for rebuild. Moving them into ready to build files list and process them');
                     awaitingFiles.forEach((currentFile) => {
                        delete this.filesToBuild.awaits[currentFile];
                        this.filesToBuild.ready[currentFile] = true;
                     });
                  }
               }
            }

            // reset newChanged flag after each iteration to properly check of
            // changed files between watcher iterations
            this.newChanged = false;
         } catch (error) {
            logger.error({
               message: 'critical watcher error occurred!',
               error
            });
            process.exit(1);
         }
      }, 200);
   }

   // run single file gulp task for current file
   updateChangedFiles(filePath) {
      // ignore changes until common build is finished
      if (this.commonBuildStarted) {
         return;
      }

      this.newChanged = true;

      // add file into awaiting queue until common build or single build of this file
      // is completed
      if (this.filesToBuild.ready.hasOwnProperty(filePath)) {
         this.filesToBuild.awaits[filePath] = true;
      } else {
         this.filesToBuild.ready[filePath] = true;
      }
   }
}

/**
 * Get directories list to be watched by watcher.
 * Ignore modules that are compiled and watch for changes in
 * any other interface module
 * @returns {*[]}
 */
function getDirectoriesListToWatch() {
   const result = [];

   gulpConfig.modules.forEach((module) => {
      if (typeof module.compiled === 'boolean') {
         if (!module.compiled) {
            result.push(toPosix(module.path));
         }
      } else {
         result.push(toPosix(module.path));
      }
   });

   fs.outputJsonSync(path.join(SOURCE_ROOT, 'directories_to_watch.json'), result);

   return result;
}

module.exports = {
   WatcherTask,
   directoriesToWatch: getDirectoriesListToWatch()
};

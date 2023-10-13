'use strict';

const ModuleInfo = require('../../gulp/builder/classes/module-info');
const { path, toPosix } = require('../../lib/platform/path');
const TaskParameters = require('../../gulp/common/classes/task-parameters');
const Cache = require('../../gulp/builder/classes/cache');
const Configuration = require('../../gulp/builder/classes/configuration');
const { getNormalizedRawConfig } = require('../../gulp/common/configuration-reader');
const { generateReadModuleCache } = require('../../gulp/builder/classes/modules-cache');

const dirname = toPosix(__dirname);
const cachePath = path.join(dirname, 'cache');
const DEFAULT_CONFIG = {
   cache: './cache',
   output: './output',
   modules: [{
      name: 'Module1',
      path: './Module1',
      changedFiles: ['./test.ts', './test.less', './test.wml', './test.xhtml', './test.tmpl']
   }]
};


function generateSimpleEnvironment(module) {
   const moduleInfo = new ModuleInfo(module, '/path/to/output/');
   const config = new Configuration();
   config.changedFilesWithDependencies = {};
   config.deletedFiles = [];
   config.modulesWithEmptyChangedFiles = 0;
   return { moduleInfo, config };
}

/**
 * generate input-paths and dependencies meta for tests
 * @param cache
 * @param moduleInfo
 * @param files
 */
function generateLastStoreMeta(cache, moduleInfo, files) {
   cache.setDefaultStore(moduleInfo);
   files.forEach((currentFile) => {
      cache.setDefaultInputFileMeta('lastStore', moduleInfo, 'test123', currentFile, currentFile);
      cache.lastStore.dependencies[currentFile] = [currentFile.replace(moduleInfo.name, `Another${moduleInfo.name}`)];
   });
}

async function generateFullEnvironment(gulpConfig) {
   const config = new Configuration();
   config.configFile = path.join(cachePath);

   /**
    * если подготовка исходников выключена, значит
    * нам необходим только чистый конфиг гальпа и
    * соответственно нам не нужно работать с файловой
    * системой - проверять физическое существование
    * исходников а также симличить все модули в одну
    * папку, всё это проверяется в отдельных юнитах
    */
   config.disableSourcesPrepare = true;
   config.rawConfig = getNormalizedRawConfig(
      config.configFile,
      gulpConfig || DEFAULT_CONFIG,
      {
         startErrorMessage: 'test123',
         disableSourcesPrepare: true
      }
   );
   config.setConfigDirectories();
   config.generateConfig();
   const taskParameters = new TaskParameters(
      config,
      new Cache(config),
      config.localizations.length > 0 && config.isReleaseMode
   );
   const moduleInfo = config.modules[0];
   const gulpSrcOptions = {};
   generateLastStoreMeta(
      taskParameters.cache,
      moduleInfo,
      config.changedFilesWithDependencies[moduleInfo.name]
   );
   await generateReadModuleCache(taskParameters, moduleInfo)();
   taskParameters.cache.migrateNotChangedFiles(moduleInfo, taskParameters.config);
   return {
      taskParameters,
      gulpSrcOptions,
      moduleInfo
   };
}

module.exports = {
   generateSimpleEnvironment,
   generateFullEnvironment
};

/* eslint-disable global-require */
'use strict';

const { path, toPosix } = require('../../lib/platform/path');
const fs = require('fs-extra'),
   chai = require('chai'),
   chaiAsPromised = require('chai-as-promised');

// TODO: разобраться почему объявление gulp после WS не работает
require('gulp');

// логгер - глобальный, должен быть определён до инициализации WS
require('../../lib/logger').setGulpLogger();

const { getTsConfigPath, getCompilerOptions } = require('../../lib/config-helpers');

chai.use(chaiAsPromised);
chai.should();

const dirname = toPosix(__dirname);

const testsRoot = path.join(dirname, '..');
const fixtureWSPath = path.join(testsRoot, 'fixtureWS');
const nodeModulesPath = path.join(testsRoot, '..', 'node_modules');

async function copyWS(modules) {
   const logsPath = path.join(fixtureWSPath, 'logs');
   const prepareWS = require('../../gulp/common/generate-task/prepare-ws.js');
   const Cache = require('../../gulp/builder/classes/cache');
   const TaskParameters = require('../../gulp/common/classes/task-parameters');
   const Config = require('../../gulp/builder/classes/configuration');

   await fs.remove(fixtureWSPath);

   const config = new Config();
   config.builderTests = true;
   config.ESVersion = 2019;
   process.env.ESVersion = 2019;
   config.tsconfig = getTsConfigPath();
   config.tsCompilerOptions = getCompilerOptions(config.tsconfig, config.ESVersion);
   config.tsCompilerOptions.target = `es${config.ESVersion}`;
   config.cachePath = fixtureWSPath;
   config.skipChangedFiles = true;
   config.logs = logsPath;
   config.modules = modules;
   const taskParameters = new TaskParameters(config, new Cache(config));
   return new Promise((resolve) => {
      prepareWS(taskParameters)(resolve);
   });
}

process.on('unhandledRejection', (reason, p) => {
   // eslint-disable-next-line no-console
   console.log(
      "[00:00:00] [ERROR] Критическая ошибка в работе builder'а. ",
      'Unhandled Rejection at:\n',
      p,
      '\nreason:\n',
      reason
   );
});

function getPlatformModules() {
   const ModuleInfo = require('../../gulp/builder/classes/module-info');
   const getModuleInfo = function(moduleName, relativePath) {
      return {
         name: moduleName,
         path: path.join(nodeModulesPath, relativePath),
         required: true
      };
   };
   return [

      // необходимо добавить в тестовую платформу модуль с мета-типами
      // чтобы проверить их правильную генерацию на уровне юнит-тестов
      new ModuleInfo({
         name: 'Module',
         path: path.join(testsRoot, 'fixture/builder-generate-workflow/versionize-meta/Module'),
         required: true
      }),
      new ModuleInfo(getModuleInfo('WS.Core', 'sbis3-ws/WS.Core')),
      new ModuleInfo(getModuleInfo('RequireJsLoader', 'wasaby-requirejs-loader/RequireJsLoader')),
      new ModuleInfo(getModuleInfo('WasabyLoader', 'wasaby-requirejs-loader/WasabyLoader')),
      new ModuleInfo(getModuleInfo('Application', 'wasaby-app/src/Application')),
      new ModuleInfo(getModuleInfo('View', 'sbis3-ws/View')),
      new ModuleInfo(getModuleInfo('Vdom', 'sbis3-ws/Vdom')),
      new ModuleInfo(getModuleInfo('Router', 'Router/Router')),
      new ModuleInfo(getModuleInfo('Inferno', 'saby-inferno/Inferno')),
      new ModuleInfo(getModuleInfo('Types', 'saby-types/Types')),
      new ModuleInfo(getModuleInfo('I18n', 'saby-i18n/I18n')),
      new ModuleInfo(getModuleInfo('Env', 'rmi/src/client/Env')),
      new ModuleInfo(getModuleInfo('EnvTouch', 'rmi/src/client/EnvTouch')),
      new ModuleInfo(getModuleInfo('SbisEnv', 'rmi/src/client/SbisEnv')),
      new ModuleInfo(getModuleInfo('Browser', 'rmi/src/client/Browser')),
      new ModuleInfo(getModuleInfo('BrowserAPI', 'rmi/src/client/BrowserAPI')),
      new ModuleInfo(getModuleInfo('TransportCore', 'rmi/src/client/TransportCore')),
      new ModuleInfo(getModuleInfo('UI', 'saby-ui/UI')),
      new ModuleInfo(getModuleInfo('ThemesModule', 'saby-ui/ThemesModule')),
      new ModuleInfo(getModuleInfo('Compiler', 'saby-ui/Compiler')),
      new ModuleInfo(getModuleInfo('UICore', 'saby-ui/UIReact/UICore')),
      new ModuleInfo(getModuleInfo('UICommon', 'saby-ui/UICommon')),
      new ModuleInfo(getModuleInfo('LocalizationConfigs', 'sbis-core/client/LocalizationConfigs'), fixtureWSPath)
   ];
}

let initialized = false;
async function init() {
   if (!initialized) {
      try {
         const modules = getPlatformModules();
         process.env['builder-tests'] = true;
         process.env['application-root'] = fixtureWSPath;
         await copyWS(modules);
         const requiredModules = modules.map(moduleInfo => moduleInfo.name);
         require('../../gulp/common/node-ws').init(requiredModules);
         initialized = true;
      } catch (e) {
         // eslint-disable-next-line no-console
         console.log(`[00:00:00] [ERROR] Исключение при инициализации тестов: ${e.message}`);
         // eslint-disable-next-line no-console
         console.log(`Stack: ${e.stack}`);
         process.exit(1);
      }
   }
}

module.exports = init;

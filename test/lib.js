'use strict';

const { path, toPosix } = require('../lib/platform/path');
const fs = require('fs-extra');

const dirname = toPosix(__dirname);

const TIMEOUT_FOR_HEAVY_TASKS = 600000;
const trimLessError = function(message) {
   const startIndexForTriedBlock = message.indexOf(' Tried - ');
   if (startIndexForTriedBlock !== -1) {
      return message.slice(0, startIndexForTriedBlock);
   }
   return message;
};

const timeout = function(ms) {
   return new Promise(resolve => setTimeout(resolve, ms));
};

// в файловой системе HFS Plus точность хранения даты равняется 1 секунде
// из-за этого тесты могуть падать непредсказуемым образом, и при этом для пользователя проблем не будет
const timeoutForMacOS = async function() {
   if (process.platform === 'darwin') {
      await timeout(1000);
   }
};

const getMTime = async function(filePath) {
   return (await fs.lstat(filePath)).mtime.getTime();
};

const removeRSymbol = function(str) {
   return str.replace(/\r/g, '').replace(/\n$/, '');
};

const isSymlink = async(folder, filePath) => {
   const fullPath = path.join(folder, filePath);
   if (!(await fs.pathExists(fullPath))) {
      return false;
   }
   const stat = await fs.lstat(fullPath);
   return stat.isSymbolicLink();
};

const isRegularFile = async(folder, filePath) => {
   const fullPath = path.join(folder, filePath);
   if (!(await fs.pathExists(fullPath))) {
      return false;
   }
   const stat = await fs.lstat(fullPath);
   return !stat.isSymbolicLink() && stat.isFile();
};

function linkPlatform(sourceFolder) {
   const nodeModulesPath = path.join(dirname, '../node_modules');
   fs.ensureDirSync(sourceFolder);
   return Promise.all([
      fs.ensureSymlink(path.join(nodeModulesPath, 'sbis3-ws/WS.Core'), path.join(sourceFolder, 'WS.Core'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'sbis3-ws/View'), path.join(sourceFolder, 'View'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'sbis3-ws/Vdom'), path.join(sourceFolder, 'Vdom'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'Router/Router'), path.join(sourceFolder, 'Router'), 'dir'),
      fs.copy(path.join(nodeModulesPath, 'saby-types/Types'), path.join(sourceFolder, 'Types')),
      fs.ensureSymlink(path.join(nodeModulesPath, 'saby-i18n/I18n'), path.join(sourceFolder, 'I18n'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'wasaby-app/src/Application'), path.join(sourceFolder, 'Application'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/Env'), path.join(sourceFolder, 'Env'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/EnvTouch'), path.join(sourceFolder, 'EnvTouch'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/SAP'), path.join(sourceFolder, 'SAP'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/SbisEnv'), path.join(sourceFolder, 'SbisEnv'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/Browser'), path.join(sourceFolder, 'Browser'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/BrowserAPI'), path.join(sourceFolder, 'BrowserAPI'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/TransportCore'), path.join(sourceFolder, 'TransportCore'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'rmi/src/client/EnvConfig'), path.join(sourceFolder, 'EnvConfig'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'saby-ui/UI'), path.join(sourceFolder, 'UI'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'saby-ui/ThemesModule'), path.join(sourceFolder, 'ThemesModule'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'saby-ui/Compiler'), path.join(sourceFolder, 'Compiler'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'saby-ui/UICore'), path.join(sourceFolder, 'UICore'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'saby-ui/UICommon'), path.join(sourceFolder, 'UICommon'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'wasaby-requirejs-loader/RequireJsLoader'), path.join(sourceFolder, 'RequireJsLoader'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'wasaby-requirejs-loader/WasabyLoader'), path.join(sourceFolder, 'WasabyLoader'), 'dir'),
      fs.ensureSymlink(path.join(nodeModulesPath, 'saby-typescript/Typescript'), path.join(sourceFolder, 'Typescript'), 'dir')
   ]);
}

module.exports = {
   trimLessError,
   timeoutForMacOS,
   getMTime,
   removeRSymbol,
   isSymlink,
   isRegularFile,
   linkPlatform,
   TIMEOUT_FOR_HEAVY_TASKS
};

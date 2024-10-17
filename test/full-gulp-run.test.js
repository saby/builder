'use strict';

const { path, toPosix } = require('../lib/platform/path');
const fs = require('fs-extra');
const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');

// TODO: разобраться почему объявление gulp после WS не работает
require('gulp');

// логгер - глобальный, должен быть определён до инициализации WS
require('../lib/logger').setGulpLogger();
chai.use(chaiAsPromised);
chai.should();

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { linkPlatform } = require('./lib');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   outputFolder = path.join(workspaceFolder, 'output'),
   sourceFolder = path.join(workspaceFolder, 'source'),
   configPath = path.join(workspaceFolder, 'config.json');

const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};

const prepareTest = async function(fixtureFolder) {
   await clearWorkspace();
   await fs.ensureDir(sourceFolder);
   await fs.copy(fixtureFolder, sourceFolder);
};

describe('builder', () => {
   it('full gulp build must be completed successfully', async() => {
      const fixtureFolder = path.join(dirname, 'fixture/custompack');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);
      const config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: path.join(workspaceFolder, 'logs'),
         wml: true,
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль')
            },
            {
               name: 'WS.Core',
               path: path.join(sourceFolder, 'WS.Core'),
               required: true
            },
            {
               name: 'View',
               path: path.join(sourceFolder, 'View'),
               required: true
            },
            {
               name: 'UI',
               path: path.join(sourceFolder, 'UI'),
               required: true
            },
            {
               name: 'Compiler',
               path: path.join(sourceFolder, 'Compiler'),
               required: true
            },
            {
               name: 'UICore',
               path: path.join(sourceFolder, 'UICore'),
               required: true
            },
            {
               name: 'UICommon',
               path: path.join(sourceFolder, 'UICommon'),
               required: true
            },
            {
               name: 'Vdom',
               path: path.join(sourceFolder, 'Vdom'),
               required: true
            },
            {
               name: 'Typescript',
               path: path.join(sourceFolder, 'Typescript'),
               required: true
            },
            {
               name: 'Types',
               path: path.join(sourceFolder, 'Types'),
               required: true,
               depends: [
                  'Env',
                  'I18n',
                  'WasabyLoader'
               ],
            },
            {
               name: 'I18n',
               path: path.join(sourceFolder, 'I18n'),
               required: true,
               depends: [
                  'Env',
                  'Application',
                  'RequireJsLoader'
               ],
            },
            {
               name: 'Application',
               path: path.join(sourceFolder, 'Application'),
               required: true
            },
            {
               name: 'Env',
               path: path.join(sourceFolder, 'Env'),
               required: true,
               depends: [
                  'Application'
               ]
            },
            {
               name: 'Browser',
               path: path.join(sourceFolder, 'Browser'),
               required: true
            },
            {
               name: 'SAP',
               path: path.join(sourceFolder, 'SAP'),
               required: true
            },
            {
               name: 'BrowserAPI',
               path: path.join(sourceFolder, 'BrowserAPI'),
               required: true
            },
            {
               name: 'SbisEnv',
               path: path.join(sourceFolder, 'SbisEnv'),
               required: true
            },
            {
               name: 'EnvConfig',
               path: path.join(sourceFolder, 'EnvConfig'),
               required: true
            },
            {
               name: 'RequireJsLoader',
               path: path.join(sourceFolder, 'RequireJsLoader'),
               required: true,
               depends: [
                  'Application',
                  'Typescript'
               ],
            },
            {
               name: 'WasabyLoader',
               path: path.join(sourceFolder, 'WasabyLoader'),
               required: true,
               depends: [
                  'RequireJsLoader'
               ]
            },
            {
               name: 'TransportCore',
               path: path.join(sourceFolder, 'TransportCore'),
               required: true
            },
            {
               name: 'ThemesModule',
               path: path.join(sourceFolder, 'ThemesModule')
            },
            {
               name: 'EnvTouch',
               path: path.join(sourceFolder, 'EnvTouch')
            }
         ]
      };
      await fs.outputJSON(configPath, config);

      process.env['builder-tests'] = true;

      // FIXME: вылезли за пределы
      //    RangeError [ERR_CHILD_PROCESS_STDIO_MAXBUFFER]: stdout maxBuffer length exceeded
      process.env['builder-tests-skip-tsc-messages'] = true;

      await exec(`node node_modules/gulp/bin/gulp build --gulpfile=gulpfile.js --config=${configPath}`);
      await clearWorkspace();
   });
});

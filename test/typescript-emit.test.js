'use strict';

const { path, toPosix } = require('../lib/platform/path');
const fs = require('fs-extra'),
   chai = require('chai'),
   chaiAsPromised = require('chai-as-promised');

// TODO: разобраться почему объявление gulp после WS не работает
require('gulp');

// логгер - глобальный, должен быть определён до инициализации WS
require('../lib/logger').setGulpLogger();
chai.use(chaiAsPromised);
chai.should();

const { expect } = require('chai');

const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { linkPlatform } = require('./lib');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, '..', 'workspace'),
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

describe('emit-typescript', () => {
   let config;

   before(async() => {
      const fixtureFolder = path.join(dirname, 'fixture/emit-typescript');
      await prepareTest(fixtureFolder);
      await linkPlatform(sourceFolder);

      config = {
         cache: cacheFolder,
         output: outputFolder,
         logs: path.join(workspaceFolder, 'logs'),
         wml: true,
         modules: [
            {
               name: 'First',
               path: path.join(sourceFolder, 'First')
            },
            {
               name: 'Second',
               path: path.join(sourceFolder, 'Second'),
               required: true
            },
            {
               name: 'Third',
               path: path.join(sourceFolder, 'Third'),
               required: true
            }
         ]
      };

      process.env['builder-tests'] = true;

      await fs.outputJSON(configPath, config);
      await exec(`node node_modules/gulp/bin/gulp build --gulpfile=gulpfile.js --config=${configPath}`);
   });
   after(async() => {
      await clearWorkspace();
   });

   it('should not have interface dependencies', async() => {
      const first = await fs.readJson(path.join(outputFolder, 'First/.cache/components-info.json'));
      const second = await fs.readJson(path.join(outputFolder, 'Second/.cache/components-info.json'));
      const third = await fs.readJson(path.join(outputFolder, 'Third/.cache/components-info.json'));

      expect(first.componentsInfo['First/A.ts'].componentDep).have.members(['require', 'exports']);
      expect(second.componentsInfo['Second/B.tsx'].componentDep).have.members(['require', 'exports', 'First/A', 'Third/C']);
      expect(third.componentsInfo['Third/C.ts'].componentDep).have.members(['require', 'exports']);
   });

   it('should use typescript cache', async() => {
      const tscCacheFolder = path.join(cacheFolder, 'typescript-cache');

      expect(await fs.pathExists(tscCacheFolder)).to.equal(true);
   });
});

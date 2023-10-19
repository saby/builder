'use strict';

require('../lib/logger').setGulpLogger();
const Configuration = require('../gulp/builder/classes/configuration.js');
const initTest = require('./init-test');
const fs = require('fs-extra');
const { path, toPosix } = require('../lib/platform/path');

const dirname = toPosix(__dirname);
const workspaceFolder = path.join(dirname, 'workspace'),
   cacheFolder = path.join(workspaceFolder, 'cache'),
   outputFolder = path.join(workspaceFolder, 'output'),
   compiledFolder = path.join(workspaceFolder, 'compiled'),
   sourceFolder = path.join(workspaceFolder, 'source'),
   configPath = path.join(workspaceFolder, 'config.json');
const processArgs = [`--config="${configPath}"`];
const clearWorkspace = function() {
   return fs.remove(workspaceFolder);
};
const { parseThemesFlag } = require('../lib/config-helpers');
const prepareTest = async function(fixtureFolder) {
   await clearWorkspace();
   await fs.ensureDir(sourceFolder);
   await fs.copy(fixtureFolder, sourceFolder);
};
const fixtureFolder = path.join(dirname, 'fixture/builder-generate-workflow/less');
describe('configuration checker', () => {
   before(async() => {
      await initTest();
   });
   describe('initCore flag must be configured properly', () => {
      const runTest = async(gulpConfig, expectedValue) => {
         await prepareTest(fixtureFolder);

         await fs.outputJson(configPath, gulpConfig);
         const config = new Configuration();
         config.loadSync(processArgs);
         config.initCore.should.equal(expectedValue);
      };
      it('builder tests - true', async() => {
         const gulpConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: path.join(workspaceFolder, 'logs'),
            builderTests: true,
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'Модуль без тем',
                  path: path.join(sourceFolder, 'Модуль без тем')
               }
            ]
         };
         await runTest(gulpConfig, true);
      });
      it('with localization - true', async() => {
         const gulpConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: path.join(workspaceFolder, 'logs'),
            localization: [
               'en-US',
               'ru-RU'
            ],
            'default-localization': 'ru-RU',
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'Модуль без тем',
                  path: path.join(sourceFolder, 'Модуль без тем')
               }
            ]
         };
         await runTest(gulpConfig, true);
      });
      it('with templates - true', async() => {
         const gulpConfig = {
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
                  name: 'Модуль без тем',
                  path: path.join(sourceFolder, 'Модуль без тем')
               }
            ]
         };
         await runTest(gulpConfig, true);
         delete gulpConfig.wml;
         gulpConfig.deprecatedXhtml = true;
         await runTest(gulpConfig, true);
         delete gulpConfig.deprecatedXhtml;
         gulpConfig.htmlWml = true;
         await runTest(gulpConfig, true);
      });
      it('without templates, localization and not builder units - false', async() => {
         const gulpConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: path.join(workspaceFolder, 'logs'),
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль')
               },
               {
                  name: 'Модуль без тем',
                  path: path.join(sourceFolder, 'Модуль без тем')
               }
            ]
         };
         await runTest(gulpConfig, false);
      });
   });

   it('removeFromDeletedFiles must delete selected file from common config data', async() => {
      const gulpConfig = {
         cache: cacheFolder,
         output: outputFolder,
         logs: path.join(workspaceFolder, 'logs'),
         modules: [
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               changedFiles: ['./Error.less'],
               deletedFiles: ['./ForChange.less']
            }
         ]
      };

      await prepareTest(fixtureFolder);
      await fs.outputJson(configPath, gulpConfig);
      const config = new Configuration();
      config.loadSync(processArgs);

      config.deletedFiles.should.have.members(['Modul/ForChange.less']);
      config.removeFromDeletedFiles('Modul/ForChange.less');
      config.deletedFiles.should.have.members([]);
   });

   describe('patch configuration', () => {
      const prepareTestCase = async(postfix, rebuild) => {
         const gulpConfig = {
            cache: cacheFolder,
            output: `${outputFolder}${postfix}`,
            logs: path.join(workspaceFolder, 'logs'),
            modules: [
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль'),
                  rebuild
               }
            ]
         };

         await prepareTest(fixtureFolder);
         await fs.outputJson(configPath, gulpConfig);
         const config = new Configuration();
         config.loadSync(processArgs);

         return config;
      };

      it('output directory will be used "as is" if there is no modules for rebuild', async() => {
         const config = await prepareTestCase('_patch', false);

         config.hasOwnProperty('changedFilesOutput').should.be.equal(false);

         // output shouldn't be changed
         config.output.should.be.equal(`${outputFolder}_patch`);
      });

      it('output directory will be used "as is" if there is no patch postfix in it\'s name', async() => {
         const config = await prepareTestCase('', true);

         config.hasOwnProperty('changedFilesOutput').should.be.equal(false);

         // output shouldn't be changed
         config.output.should.be.equal(outputFolder);
      });

      it('changedFilesOutput is equal output and output is without "_patch" postfix if "_patch" in output\'s name and ', async() => {
         const config = await prepareTestCase('_patch', true);

         // output should be changed if contains '_patch' postfix and there is at least 1 module for rebuild
         config.changedFilesOutput = `${outputFolder}_patch`;
         config.output.should.be.equal(outputFolder);
      });
   });

   describe('themes flag', () => {
      // return theme as true(build all of we would find) if
      // there is a single theme without any modifiers
      it('regular theme', () => {
         const result = parseThemesFlag(['default']);
         result.should.deep.equal({ default: true });
      });

      // if there are themes with modifier and a regular one, we should
      // get "true" as a value of "default" theme
      it('regular theme and themes with modifiers', () => {
         const result = parseThemesFlag(['default', 'default__dark', 'default__cola']);
         result.should.deep.equal({ default: true });
      });

      // empty modifier should be parsed correctly and be a member of an array as an empty string
      it('theme with empty modifier and ones with regular modifiers', () => {
         const result = parseThemesFlag(['default__', 'default__cola', 'default__dark']);
         result.should.deep.equal({
            default: ['', 'cola', 'dark']
         });
      });
   });

   describe('check for compiled flag if selected in gulp_config as "false"', () => {
      const generateCompiledEnvironment = async() => {
         const promises = [];

         ['Modul'].forEach((currentModule) => {
            promises.push(
               fs.outputJson(
                  path.join(compiledFolder, `${currentModule}/.builder/hash.json`),
                  { sourcesHash: currentModule }
               )
            );
         });

         await Promise.all(promises);
      };
      const clearCompiledEnvironment = async() => {
         const promises = [];

         ['Модуль'].forEach((currentModule) => {
            promises.push(
               fs.remove(
                  path.join(compiledFolder, `${currentModule}/.builder/hash.json`),
                  { sourcesHash: currentModule }
               )
            );
         });

         await Promise.all(promises);
      };

      const getConfigByModulesList = async(modules, selectedModules) => {
         const gulpConfig = {
            cache: cacheFolder,
            output: outputFolder,
            logs: path.join(workspaceFolder, 'logs'),
            compiled: compiledFolder,
            selectedModules,
            modules
         };

         await prepareTest(fixtureFolder);
         await generateCompiledEnvironment();
         await fs.outputJson(configPath, gulpConfig);
         const config = new Configuration();
         config.loadSync(processArgs);

         return config;
      };

      it("'TestModule' should not have compiled true if compiled 'hash.json' meta isn't found", async() => {
         const config = await getConfigByModulesList([
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule'),
               id: 'TestModule',
               hash: 'TestModule',
               compiled: false
            }
         ], []);

         config.modules[0].compiled.should.equal(false);
         await clearCompiledEnvironment();
      });

      it('"TestModule" should have compiled true if selected as true in gulp_config', async() => {
         const config = await getConfigByModulesList([
            {
               name: 'TestModule',
               path: path.join(sourceFolder, 'TestModule'),
               id: 'TestModule',
               hash: 'TestModule',
               compiled: true
            }
         ], []);

         config.modules[0].compiled.should.equal(true);
         await clearCompiledEnvironment();
      });

      it('"Модуль" should have compiled true if hash from config equal to hash from compiled meta "hash.json"', async() => {
         const config = await getConfigByModulesList([
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               id: 'Модуль',
               hash: 'Modul',
               compiled: false
            }
         ], []);

         config.modules[0].compiled.should.equal(true);
         await clearCompiledEnvironment();
      });

      it('"Модуль" should have compiled false if hash from config differs from hash from compiled meta "hash.json"', async() => {
         const config = await getConfigByModulesList([
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               id: 'Модуль',
               hash: 'NotModul',
               compiled: false
            }
         ], []);

         config.modules[0].compiled.should.equal(false);
         await clearCompiledEnvironment();
      });


      it("'Модуль' should have compiled false if hash isn't transmitted through gulp_config", async() => {
         const config = await getConfigByModulesList([
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               id: 'Модуль',
               compiled: false
            }
         ], ['Модуль']);

         config.modules[0].compiled.should.equal(false);
         await clearCompiledEnvironment();
      });

      it("'Модуль' should have compiled false if hash equals compiled hash and module in selectedModules list", async() => {
         const config = await getConfigByModulesList([
            {
               name: 'Модуль',
               path: path.join(sourceFolder, 'Модуль'),
               id: 'Модуль',
               hash: 'Modul',
               compiled: false
            }
         ], ['Модуль']);

         config.modules[0].compiled.should.equal(false);
         await clearCompiledEnvironment();
      });

      it("'Модуль' should have compiled flag 'as is' if not found in selectedModules list", async() => {
         const runTest = async(testValue) => {
            const config = await getConfigByModulesList([
               {
                  name: 'Модуль',
                  path: path.join(sourceFolder, 'Модуль'),
                  id: 'Модуль',
                  compiled: testValue
               }
            ], []);

            config.modules[0].compiled.should.equal(testValue);
            await clearCompiledEnvironment();
         };

         await runTest(true);
         await runTest(false);
      });
   });
});

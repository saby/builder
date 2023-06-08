/* eslint-disable no-unused-expressions,require-await */
'use strict';

require('../lib/logger').setGulpLogger('warning');

const sinon = require('sinon');
const path = require('path').posix;
const { expect } = require('chai');
const fs = require('fs-extra');
const ModuleInfo = require('../gulp/builder/classes/module-info');

const {
   getThemesMeta,
   getMissingModules,
   generateJoinedThemes,
   generateSourceCode,
   generateThemeFile,
   VERSIONED_MODULES_PATH,
   LINK_DEPENDENCIES_PATH
} = require('../lib/save-themes');

describe('lib/save-themes', () => {
   let readFileReturns;
   let outputFileData;

   beforeEach(() => {
      sinon.stub(fs, 'readFile').callsFake(
         async file => (readFileReturns.has(file) ? readFileReturns.get(file) : '')
      );
      sinon.stub(fs, 'readJson').callsFake(
         async file => (readFileReturns.has(file) ? readFileReturns.get(file) : {})
      );
      sinon.stub(fs, 'outputFile').callsFake(
         async(file, data) => outputFileData.set(file, data)
      );
      sinon.stub(fs, 'outputJson').callsFake(
         async(file, data) => outputFileData.set(file, data)
      );
      sinon.stub(fs, 'pathExists').callsFake(
         async file => readFileReturns.has(file)
      );

      readFileReturns = new Map();
      outputFileData = new Map();
   });

   afterEach(() => {
      sinon.restore();
   });

   describe('getMissingModules()', () => {
      it('get correct list of missing themes in depends section of ThemesModule s3mod', () => {
         let errorExists = false;

         try {
            const moduleListOfPackedThemes = new Set(['ThemeModule1', 'ThemeModule2', 'ThemeModule3']);
            const themesModuleInfo = {
               name: 'ThemesModule',
               depends: ['ThemeModule1', 'ThemeModule3']
            };
            const result = getMissingModules(moduleListOfPackedThemes, themesModuleInfo);

            expect(result).to.have.members(['ThemeModule2']);
         } catch (err) {
            errorExists = true;
         }

         expect(errorExists).to.be.false;
      });
   });

   describe('getThemesMeta', () => {
      function createTaskParameters() {
         const taskParameters = {
            config: {
               themesModuleInfo: new ModuleInfo(
                  {
                     name: 'ThemesModule',
                     responsible: 'some responsible',
                     path: 'someRoot/ThemesModule',
                     depends: []
                  },
                  'someCache'
               ),
               modules: [
                  new ModuleInfo(
                     {
                        name: 'TestModule-default-theme',
                        responsible: 'some responsible',
                        path: 'TestModule-default-theme',
                        newThemesModule: true,
                        depends: []
                     },
                     'someCache'
                  ),
                  new ModuleInfo(
                     {
                        name: 'AnotherModule-default-theme',
                        responsible: 'some responsible',
                        path: 'AnotherModule-default-theme',
                        newThemesModule: true,
                        depends: []
                     },
                     'someCache'
                  ),
               ],
            },
            cache: {
               getThemesMeta: () => ({
                  themes: {
                     default: [],
                     'retail__dark': []
                  }
               })
            }
         };

         return taskParameters;
      }

      /**
       * Генерируем помодульные мета-данные themesMap.json таким образом,
       * чтобы у первого модуля была default тема и модификатор cola, а у другого
       * модуля также была default тема, но другой модификатор. Итогом теста должно
       * стать обьединение всех помодульных данных в единую мету.
       * @param modules
       */
      function generateThemesMetaJson(modules) {
         ['cola', 'dark'].forEach((currentModifier, index) => {
            const currentThemesMapMeta = {};
            currentThemesMapMeta[`${modules[index].name}/${currentModifier}/theme`] = `default__${currentModifier}`;
            currentThemesMapMeta[`${modules[index].name}/theme`] = 'default';
            readFileReturns.set(`${modules[index].output}/themesMap.json`, currentThemesMapMeta);
         });
      }

      it('get themes meta returns all meta from each interface module themesMap meta and missing themes from cache', async() => {
         const taskParameters = createTaskParameters();
         taskParameters.config.modules.forEach((currentModule) => {
            currentModule.newThemesModule = true;
         });
         generateThemesMetaJson(taskParameters.config.modules);

         const result = await getThemesMeta(taskParameters);

         // По итогу исполнения функции getThemesMeta мы должны:
         // Вытащить физически мета-данные(themesMap.json) из каждого модуля темы
         // А также учесть все темы-пустышки, которые нельзя получить из физических
         // мета-данных, поскольку для них описания темы не существует физически
         // например когда существует тема, но ещё не описан определённый модификатор
         // тогда в ThemesModule мы должны описать тему-пустышку.
         expect(result).to.deep.equal({
            'default__cola': ['TestModule-default-theme/cola/theme'],
            'default__dark': ['AnotherModule-default-theme/dark/theme'],
            'default': ['TestModule-default-theme/theme', 'AnotherModule-default-theme/theme'],
            'retail__dark': []
         });
      });
   });

   describe('generateJoinedThemes()', () => {
      function createParameters() {
         const outputPath = '/output/';
         const rootPath = '/root/';
         const fileSuffix = '.suffix';
         const resourceRoot = '/resource/';
         const currentTheme = 'theme-name';
         const taskParameters = {
            config: {
               themesModuleInfo: new ModuleInfo(
                  {
                     name: 'ThemesModule',
                     responsible: 'some responsible',
                     path: 'someRoot/ThemesModule',
                     depends: []
                  },
                  'someCache'
               ),
               outputPath,
               buildRtl: false,
               getModuleInfoByName: moduleInfoName => ({ moduleInfoName })
            },
            cache: {
               getFileExternalDependencies: () => ['SomeExternalDependency']
            }
         };
         const isThemeForReleaseOnly = true;

         return {
            outputPath,
            rootPath,
            fileSuffix,
            resourceRoot,
            isThemeForReleaseOnly,
            currentTheme,
            taskParameters
         };
      }

      it('should output required files', async() => {
         const cfg = createParameters();
         const uiModuleName = 'UIModule';
         const fileName = `${uiModuleName}/themes/file`;
         const themes = {
            [cfg.currentTheme]: [fileName]
         };
         const { themesModuleInfo } = cfg.taskParameters.config;
         themesModuleInfo.depends.push(uiModuleName);

         const filePathToRead = path.join(cfg.outputPath, `${fileName}${cfg.fileSuffix}.css`);
         readFileReturns.set(filePathToRead, '/* content */');

         await generateJoinedThemes(
            cfg.taskParameters,
            cfg.rootPath,
            cfg.isThemeForReleaseOnly,
            cfg.fileSuffix,
            themes,
            cfg.resourceRoot
         );

         const themesFile = `ThemesModule/${cfg.currentTheme}${cfg.fileSuffix}.css`;
         const themesFilePath = path.join(cfg.rootPath, themesFile);
         const verFilePath = path.join(cfg.rootPath, VERSIONED_MODULES_PATH);
         const linkDepsFilePath = path.join(cfg.rootPath, LINK_DEPENDENCIES_PATH);

         expect(outputFileData.has(themesFilePath)).to.be.true;
         expect(outputFileData.get(themesFilePath)).to.equal(
            '/* UIModule/themes/file */\n' +
            '/* content */\n'
         );

         expect(outputFileData.has(verFilePath)).to.be.true;
         expect(outputFileData.get(verFilePath)).to.deep.equal([themesFile]);

         expect(outputFileData.has(linkDepsFilePath)).to.be.true;
         expect(outputFileData.get(linkDepsFilePath)).to.deep.equal(['UIModule', 'SomeExternalDependency'].sort());

         expect(outputFileData.size).to.equal(3);
      });
      it('should output required files with rtl', async() => {
         const cfg = createParameters();
         const uiModuleName = 'UIModule';
         const fileName = `${uiModuleName}/themes/file`;
         const themes = {
            [cfg.currentTheme]: [fileName]
         };
         cfg.taskParameters.config.themesModuleInfo.depends.push(uiModuleName);
         cfg.taskParameters.config.buildRtl = true;

         const filePathToRead = path.join(cfg.outputPath, `${fileName}${cfg.fileSuffix}.css`);
         readFileReturns.set(filePathToRead, '/* content */');

         const rtlFilePathToRead = path.join(cfg.outputPath, `${fileName}.rtl${cfg.fileSuffix}.css`);
         readFileReturns.set(rtlFilePathToRead, '/* rtl content */');

         await generateJoinedThemes(
            cfg.taskParameters,
            cfg.rootPath,
            cfg.isThemeForReleaseOnly,
            cfg.fileSuffix,
            themes,
            cfg.resourceRoot
         );

         const themesFile = `ThemesModule/${cfg.currentTheme}${cfg.fileSuffix}.css`;
         const themesFilePath = path.join(cfg.rootPath, themesFile);

         const rtlThemesFile = `ThemesModule/${cfg.currentTheme}.rtl${cfg.fileSuffix}.css`;
         const rtlThemesFilePath = path.join(cfg.rootPath, rtlThemesFile);

         const verFilePath = path.join(cfg.rootPath, VERSIONED_MODULES_PATH);
         const linkDepsFilePath = path.join(cfg.rootPath, LINK_DEPENDENCIES_PATH);

         expect(outputFileData.has(themesFilePath)).to.be.true;
         expect(outputFileData.get(themesFilePath)).to.equal(
            '/* UIModule/themes/file */\n' +
            '/* content */\n'
         );

         expect(outputFileData.has(rtlThemesFilePath)).to.be.true;
         expect(outputFileData.get(rtlThemesFilePath)).to.equal(
            '/* UIModule/themes/file */\n' +
            '/* rtl content */\n'
         );

         expect(outputFileData.has(verFilePath)).to.be.true;
         expect(outputFileData.get(verFilePath)).to.deep.equal([rtlThemesFile, themesFile]);

         expect(outputFileData.has(linkDepsFilePath)).to.be.true;
         expect(outputFileData.get(linkDepsFilePath)).to.deep.equal(['UIModule', 'SomeExternalDependency'].sort());

         expect(outputFileData.size).to.equal(4);
      });
      it('should append versioned modules', async() => {
         const cfg = createParameters();
         const uiModuleName = 'UIModule';
         const fileName = `${uiModuleName}/themes/file`;
         const themes = {
            [cfg.currentTheme]: [fileName]
         };
         cfg.taskParameters.config.themesModuleInfo.depends.push(uiModuleName);
         cfg.taskParameters.config.buildRtl = true;

         const verFilePath = path.join(cfg.rootPath, VERSIONED_MODULES_PATH);
         const linkDepsFilePath = path.join(cfg.rootPath, LINK_DEPENDENCIES_PATH);
         const versionizedModulesContent = ['UIModule/expectedFile'];
         readFileReturns.set(verFilePath, [...versionizedModulesContent]);

         await generateJoinedThemes(
            cfg.taskParameters,
            cfg.rootPath,
            cfg.isThemeForReleaseOnly,
            cfg.fileSuffix,
            themes,
            cfg.resourceRoot
         );

         expect(outputFileData.has(verFilePath)).to.be.true;
         expect(outputFileData.get(verFilePath)).to.deep.equal([
            ...versionizedModulesContent,
            `ThemesModule/${cfg.currentTheme}${cfg.fileSuffix}.css`,
            `ThemesModule/${cfg.currentTheme}.rtl${cfg.fileSuffix}.css`
         ].sort());

         expect(outputFileData.has(verFilePath)).to.be.true;
         expect(outputFileData.get(linkDepsFilePath)).to.deep.equal(['UIModule', 'SomeExternalDependency'].sort());

         expect(outputFileData.size).to.equal(4);
      });
   });

   describe('generateSourceCode()', () => {
      it('should generate source code with replaced templates in desc order', () => {
         const contents = new Map([
            ['UIModule/first.css', '/* first */'],
            ['UIModule/second.css', '/* second; resourceRoot="%{RESOURCE_ROOT}" */'],
         ]);
         const resourceRoot = '/resource/';

         const source = generateSourceCode(contents, resourceRoot);
         const expectedSource = (
            '/* UIModule/second.css */\n' +
            '/* second; resourceRoot="/resource/" */\n' +
            '/* UIModule/first.css */\n' +
            '/* first */\n'
         );

         expect(source).to.equal(expectedSource);
      });
   });

   describe('generateThemeFile()', () => {
      it('should create versionized theme file', async() => {
         const rootPath = '/root/';
         const outputPath = '/output/';
         const currentTheme = 'theme-name';
         const fileSuffix = '.suffix';
         const resourceRoot = '/resource/';
         const versionedModules = [];
         const fileName = 'UIModule/themes/file';
         const themes = {
            [currentTheme]: [fileName]
         };

         const filePathToRead = path.join(outputPath, `${fileName}${fileSuffix}.css`);
         readFileReturns.set(filePathToRead, '/* content */');

         await generateThemeFile(
            null,
            rootPath,
            outputPath,
            themes,
            currentTheme,
            fileSuffix,
            resourceRoot,
            versionedModules
         );

         const themesFilePath = `ThemesModule/${currentTheme}${fileSuffix}.css`;
         const fullThemesFilePath = path.join(rootPath, themesFilePath);

         expect(versionedModules).to.have.members([themesFilePath]);
         expect(outputFileData).to.have.key(fullThemesFilePath);
         expect(outputFileData.get(fullThemesFilePath)).to.equal('/* UIModule/themes/file */\n/* content */\n');
      });
   });
});

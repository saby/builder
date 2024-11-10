/**
 * Helpers for saving themes.
 * @author Kolbeshin F.A.
 */

'use strict';
const pMap = require('p-map');
const { path } = require('../lib/platform/path');
const fs = require('fs-extra');
const { descendingSort } = require('./helpers');
const logger = require('./logger').logger();

const THEMES_MODULE_SOURCE_URL = 'https://git.sbis.ru/saby/ui/-/blob/HEAD/ThemesModule/ThemesModule.s3mod';
const VERSIONED_MODULES_PATH = 'ThemesModule/.builder/versioned_modules.json';
const LINK_DEPENDENCIES_PATH = 'ThemesModule/.builder/link_dependencies.json';

const toUIModuleName = filePath => filePath.split('/').shift();
const toFilePath = (file, fileSuffix) => `${file}${fileSuffix}.css`;
const toCodeFragment = (fileName, content) => `/* ${fileName} */\n${content}\n`;
const replaceResourceRootPattern = (source, value) => source.replace(/%\{RESOURCE_ROOT\}/g, value);
const getVersionedModulesPath = rootPath => path.join(rootPath, 'ThemesModule/.builder/versioned_modules.json');
const getLinkDependenciesPath = rootPath => path.join(rootPath, 'ThemesModule/.builder/link_dependencies.json');

/**
 * Get list of missing theme modules.
 * @param {Set} themeModules Set of theme modules
 * @param {ModuleInfo} themesModuleInfo Instance of UI module "ThemesModule"
 * @returns {String[]} List of missing modules.
 */
function getMissingModules(themeModules, themesModuleInfo) {
   if (!themesModuleInfo) {
      throw new Error('Module ThemesModule is missing!');
   }

   return Array
      .from(themeModules)
      .filter(moduleName => !themesModuleInfo.depends.includes(moduleName));
}

/**
 * Reads each theme part content and joins it into common
 * theme content
 * @param {String} cachePath - current cache path
 * @param {String} extraSuffix - extra file suffix
 * @param {String|null} fileSuffix - current file suffix. It's null by default
 * @param {Array} files - list of current theme parts
 * @returns {Map}
 */
async function loadThemeContents(cachePath, fileSuffix, files) {
   const contents = new Map();

   await pMap(files, async(filePath) => {
      contents.set(
         filePath,
         await fs.readFile(
            path.join(cachePath, toFilePath(filePath, fileSuffix)),
            'utf8'
         )
      );
   });

   return contents;
}

function generateSourceCode(contents, resourceRoot) {
   let source = '';

   descendingSort([...contents.keys()]).forEach((filePath) => {
      source += toCodeFragment(filePath, contents.get(filePath));
   });

   return replaceResourceRootPattern(source, resourceRoot);
}

async function generateThemeFile(
   themesModuleInfo,
   rootPath,
   outputPath,
   themes,
   currentTheme,
   fileSuffix,
   resourceRoot,
   versionedModules
) {
   const themeFilePath = path.join(
      'ThemesModule',
      toFilePath(currentTheme, fileSuffix)
   );
   const contents = await loadThemeContents(
      outputPath,
      fileSuffix,
      themes[currentTheme]
   );

   const resultThemeContent = generateSourceCode(contents, resourceRoot);
   await fs.outputFile(path.join(rootPath, themeFilePath), resultThemeContent);

   if (!versionedModules.includes(themeFilePath)) {
      versionedModules.push(themeFilePath);
   }
}

async function loadVersionedModules(root) {
   const filePath = getVersionedModulesPath(root);

   if (await fs.pathExists(filePath)) {
      return fs.readJson(filePath);
   }

   return [];
}

async function saveVersionedModules(moduleRoot, appRoot, array) {
   const promises = [];

   if (moduleRoot !== appRoot) {
      promises.push(
         fs.outputJson(
            getVersionedModulesPath(moduleRoot),
            array.sort()
         )
      );
   }

   promises.push(
      fs.outputJson(
         getVersionedModulesPath(appRoot),
         array.sort()
      )
   );

   await Promise.all(promises);
}

async function saveLinkDependencies(moduleRoot, appRoot, linkDeps) {
   const promises = [];

   if (moduleRoot !== appRoot) {
      promises.push(
         fs.outputJson(
            getLinkDependenciesPath(moduleRoot),
            linkDeps
         )
      );
   }

   promises.push(
      fs.outputJson(
         getLinkDependenciesPath(appRoot),
         linkDeps
      )
   );

   await Promise.all(promises);
}

/**
 * Generates themes for current project from
 * each theme parts by themes meta
 * @param {TaskParameters} taskParameters - current task parameters instance
 * @param {String} rootPath - current application root
 * @param {boolean} isThemeForReleaseOnly - a sign are there should be saved only minimized css themes
 * @param {String} fileSuffix - suffix for file if needed
 * (for release and debug mode it is '.min' and '' respectively)
 * @param {Object} themes - all meta information about
 * themes in current building project
 * @param {String} resourceRoot - current value of resourceRoot variable
 * @returns {Promise<void>}
 */
async function generateJoinedThemes(
   taskParameters,
   rootPath,
   isThemeForReleaseOnly,
   fileSuffix,
   themes,
   resourceRoot
) {
   const { themesModuleInfo, outputPath } = taskParameters.config;
   const uiModulesWithThemes = new Set();
   const externalDependencies = new Set();
   const versionedModules = await loadVersionedModules(rootPath);
   const extraSuffixes = [''];

   if (taskParameters.config.buildRtl) {
      extraSuffixes.push('.rtl');
   }

   for (const extraSuffix of extraSuffixes) {
      /* eslint-disable-next-line no-await-in-loop */
      await pMap(Object.keys(themes), async(currentTheme) => {
         // Register UIModules with themes
         themes[currentTheme].forEach((file) => {
            const currentModuleName = toUIModuleName(file);
            const currentExternalDependencies = taskParameters.cache.getFileExternalDependencies(
               currentModuleName,
               `${path.basename(file)}.less`
            );
            currentExternalDependencies.forEach(dep => externalDependencies.add(dep));
            externalDependencies.add(currentModuleName);
            uiModulesWithThemes.add(currentModuleName);
         });

         // Generate debug file
         if (!isThemeForReleaseOnly) {
            await generateThemeFile(
               themesModuleInfo,
               rootPath,
               outputPath,
               themes,
               currentTheme,
               extraSuffix,
               resourceRoot,
               versionedModules
            );
         }

         // Generate release file
         if (typeof fileSuffix === 'string') {
            await generateThemeFile(
               themesModuleInfo,
               rootPath,
               outputPath,
               themes,
               currentTheme,
               extraSuffix + fileSuffix,
               resourceRoot,
               versionedModules
            );
         }
      });
   }

   try {
      // check for themes dependencies if there are any packed themes into ThemesModule
      if (uiModulesWithThemes.size > 0) {
         const missingThemes = getMissingModules(uiModulesWithThemes, themesModuleInfo);

         missingThemes.forEach((currentModuleName) => {
            const moduleInfo = taskParameters.config.getModuleInfoByName(currentModuleName);
            const message = `Module ${currentModuleName} isn't specified in "load_after" section of ThemesModule.s3mod. Please, add it here ${THEMES_MODULE_SOURCE_URL}`;

            logger.warning({ message, moduleInfo });
         });
      }
   } catch (error) {
      logger.warning({ error });
   }

   await saveVersionedModules(taskParameters.config.outputPath, rootPath, versionedModules);
   await saveLinkDependencies(taskParameters.config.outputPath, rootPath, [...externalDependencies].sort());
}

async function getThemesMeta(taskParameters) {
   const themesModules = taskParameters.config.modules.filter(currentModule => currentModule.newThemesModule);
   const { themes } = taskParameters.cache.getThemesMeta();
   const result = {};
   await pMap(
      themesModules,
      async(currentModule) => {
         const themesMapPath = path.join(currentModule.output, 'themesMap.json');
         if (await fs.pathExists(themesMapPath)) {
            const currentThemesMap = await fs.readJson(themesMapPath);
            Object.keys(currentThemesMap)
               .forEach((currentThemeFile) => {
                  const currentThemeName = currentThemesMap[currentThemeFile];

                  if (!result[currentThemeName]) {
                     result[currentThemeName] = [];
                  }
                  result[currentThemeName].push(currentThemeFile);
               });
         }
      },
      {
         concurrency: 50
      }
   );

   // В кеше помечаются темы-пустышки, они физически в конкретном интерфейсном модуле не сохраняются
   // поэтому нам необходимо дополнить ими информацию о темах перед их сборкой, если этого не сделать
   // может возникнуть подобная ситуация, когда грузится тема-пустышка.
   // https://online.sbis.ru/opendoc.html?guid=38dc50a8-b192-4fd0-8a16-d5897fc293c5&client=3
   // Это возможно, например, когда существует модуль с темой 'retail', но ещё не описан под неё
   // модификатор 'dark', тогда в ThemesModule мы должны описать тему-пустышку 'retail__dark.css',
   // чтобы не было 404х ошибок.
   Object.keys(themes).forEach((currentTheme) => {
      if (!result[currentTheme]) {
         result[currentTheme] = themes[currentTheme];
      }
   });

   return result;
}

module.exports = {
   getMissingModules,
   generateJoinedThemes,
   getThemesMeta,

   // for unit tests only:
   generateSourceCode,
   generateThemeFile,
   VERSIONED_MODULES_PATH,
   LINK_DEPENDENCIES_PATH
};

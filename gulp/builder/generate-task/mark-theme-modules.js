/**
 * Marks interface modules as themed if there is a _theme.less file
 * in them - it's a definite description of new theme type
 * @author Kolbeshin F.A.
 */

'use strict';

const gulp = require('gulp');
const { path } = require('../../../lib/platform/path');
const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const mapStream = require('map-stream');
const fs = require('fs-extra');
const logger = require('../../../lib/logger').logger();
const approvedThemes = require('../../../resources/approved-themes');
const garbageDeclarations = require('../../../lib/less/fallback');
const toPosixVinyl = require('../../common/plugins/to-posix-vinyl');
const unapprovedThemes = new Set();

/**
 * Parses current theme name. Checks it for new theme name template:
 * <first part> - <second part> - theme.
 * First part - interface module name, that exists in current project
 * Second part - theme name
 * Example: for interface module "Controls" with theme name "online" interface module
 * module would be named to "Controls-online-theme"
 * Returns themeName - current theme name
 * @param{Set} modulesList - current project list of interface modules
 * @param{Array} currentModuleNameParts - parts of current interface module name
 * @returns {{themeName: string, moduleName: *}}
 */
function parseThemeName(modulesList, currentModuleNameParts) {
   const currentModuleParts = [...currentModuleNameParts];

   // clone moduleName parts to avoid errors in modules
   // analyzing due to override of current module name parts.
   if (currentModuleParts.length > 2) {
      const themeNameParts = [];
      let interfaceModuleParsed = false;
      while (!interfaceModuleParsed && currentModuleParts.length > 0) {
         themeNameParts.unshift(currentModuleParts.pop());
         const presumedModuleName = currentModuleParts.join('-');
         if (modulesList.has(presumedModuleName)) {
            interfaceModuleParsed = presumedModuleName;
         }
      }

      // remove "theme" postfix from array to get exact theme name
      themeNameParts.pop();

      // if there is no origin module in this build, get themeName at first as second split
      // value after theme postfix, remaining parts should be used as interface module name
      let themeName = themeNameParts.join('-');
      if (!interfaceModuleParsed) {
         themeName = themeNameParts.pop();
         interfaceModuleParsed = themeNameParts.join('-');
      }
      return { themeName, originModule: interfaceModuleParsed };
   }
   return {
      themeName: null,
      originModule: null
   };
}

function prepareFallbackDeclaration(moduleInfo, fallbackDeclarations) {
   if (!fallbackDeclarations.hasOwnProperty(moduleInfo.name)) {
      fallbackDeclarations[moduleInfo.name] = {
         moduleInfo,
         declarations: { },
         hasFallbackFile: false
      };
   }
}

function sortDeclarations(currentModuleDeclarations) {
   const result = {};
   Object.keys(currentModuleDeclarations).sort().forEach((currentDeclaration) => {
      result[currentDeclaration] = currentModuleDeclarations[currentDeclaration];
   });
   return result;
}

/**
 * Search theme task initialization
 * @param {TaskParameters} taskParameters a whole list of parameters needed for current project
 * build
 * @returns {Undertaker.TaskFunction}
 */
function generateTaskForMarkThemeModules(taskParameters) {
   // analyse only interface modules supposed to have themes
   const modulesWithThemes = [];
   const buildModulesNames = new Set();
   const defaultThemesContent = {};

   taskParameters.config.modules.forEach((currentModule) => {
      if (currentModule.name.endsWith('-theme')) {
         modulesWithThemes.push(currentModule);
      }
      if (!currentModule.name.endsWith('-theme')) {
         buildModulesNames.add(path.basename(currentModule.output));
      }
   });
   if (!taskParameters.config.less || modulesWithThemes.length === 0) {
      return function skipMarkThemeModules(done) {
         done();
      };
   }

   const fallbackDeclarations = { };

   const tasks = modulesWithThemes.map((moduleInfo) => {
      const input = [
         path.join(moduleInfo.path, '/**/_theme.less'),
         path.join(moduleInfo.path, '/**/theme.less'),
         path.join(moduleInfo.path, '/_variables.less'),
         path.join(moduleInfo.path, '/fallback.json'),
         path.join(moduleInfo.path, '/**/variables/**.less')
      ];
      moduleInfo.modifiers = [];
      const currentModuleName = path.basename(moduleInfo.output);
      const currentModuleNameParts = currentModuleName.split('-');

      /**
       * Interface module name for new theme should always contains 3 parts:
       * 1)Interface module name for current theme
       * 2)Current theme name
       * 3) "theme" postfix
       * Other Interface modules will be ignored from new theme's processing
       */
      const { themeName, originModule } = parseThemeName(buildModulesNames, currentModuleNameParts);
      defaultThemesContent[moduleInfo.name] = {

         // there will be listed all themes but default for current
         // themed interface module
         themes: [],
         themeName,
         sourcePath: moduleInfo.path,
         modifiers: moduleInfo.modifiers
      };

      return function markThemeModules() {
         return gulp
            .src(input, { dot: false, nodir: true, allowEmpty: true })
            .pipe(handlePipeException('markThemeModules', taskParameters, moduleInfo))
            .pipe(toPosixVinyl())
            .pipe(mapStream((file, done) => {
               const fileName = path.basename(file.pPath);
               if (['_theme.less', 'theme.less'].includes(fileName)) {
                  /**
                   * Interface module name for new theme should always contains 3 parts:
                   * 1)Interface module name for current theme
                   * 2)Current theme name
                   * 3) "theme" postfix
                   * Other Interface modules will be ignored from new theme's processing
                   */
                  if (currentModuleNameParts.length > 2) {
                     taskParameters.setThemedModule(path.basename(moduleInfo.output), originModule);

                     // if unapproved theme has already been declared in unapproved themes list,
                     // we don't need to log it then.
                     if (!approvedThemes.has(themeName) && !unapprovedThemes.has(themeName)) {
                        logger.warning({
                           message: `Theme "${themeName}" isn't found in approved themes list. You need to get an approval from Begunov A. for this theme first and then write a task to Kolbeshin F. for updating the list.`,
                           moduleInfo
                        });
                        unapprovedThemes.add(themeName);
                     }
                     if (!(taskParameters.config.themes instanceof Array &&
                           !taskParameters.config.themes.hasOwnProperty(themeName)
                     )) {
                        const relativeThemeParts = file.pRelative.split(path.sep);
                        const currentModifier = relativeThemeParts.length > 1 ? relativeThemeParts[0] : '';

                        if (fileName === 'theme.less') {
                           if (currentModifier) {
                              defaultThemesContent[moduleInfo.name].themes.push(currentModifier);
                           } else {
                              defaultThemesContent[moduleInfo.name].isThemeLess = true;
                           }
                        }

                        moduleInfo.modifiers.push(currentModifier);
                        taskParameters.cache.setBaseThemeInfo(`${themeName}${currentModifier ? `__${currentModifier}` : ''}`);
                        moduleInfo.newThemesModule = true;
                        moduleInfo.themeName = themeName;
                     }
                  }
               } else if (fileName === 'fallback.json') {
                  try {
                     const currentThemeVariables = JSON.parse(file.contents);
                     taskParameters.cache.addCssVariables(`${moduleInfo.name}/fallback.json`, currentThemeVariables);

                     // set module css variables cache for first time builds and check it in
                     // further builds
                     if (taskParameters.cache.isFirstBuild()) {
                        taskParameters.cache.setCurrentCssVariablesCache(moduleInfo.name, currentThemeVariables);
                     } else {
                        taskParameters.cache.checkCurrentCssVariablesCache(moduleInfo.name, currentThemeVariables);
                     }

                     prepareFallbackDeclaration(moduleInfo, fallbackDeclarations);
                     fallbackDeclarations[moduleInfo.name].hasFallbackFile = true;
                  } catch (error) {
                     logger.error({
                        message: 'An error occurred when tried to parse fallback.json',
                        filePath: file.pPath,
                        moduleInfo,
                        error
                     });
                  }
               } else {
                  prepareFallbackDeclaration(moduleInfo, fallbackDeclarations);
                  garbageDeclarations(file, fallbackDeclarations[moduleInfo.name].declarations, moduleInfo);
               }
               done();
            }));
      };
   });

   const processFallbacks = function processFallbacks(done) {
      Object.values(fallbackDeclarations).forEach((decl) => {
         const { declarations, hasFallbackFile, moduleInfo } = decl;

         if (hasFallbackFile) {
            return;
         }

         const sortedDeclarations = sortDeclarations(declarations);

         taskParameters.cache.addCssVariables(`${moduleInfo.name}/fallback.json`, sortedDeclarations);

         // set module css variables cache for first time builds and check it in
         // further builds
         if (taskParameters.cache.isFirstBuild()) {
            taskParameters.cache.setCurrentCssVariablesCache(moduleInfo.name, sortedDeclarations);
         } else {
            taskParameters.cache.checkCurrentCssVariablesCache(moduleInfo.name, sortedDeclarations);
         }

         const fallbackPath = path.join(moduleInfo.output, 'fallback.json');
         const fallbackData = JSON.stringify(sortedDeclarations, Object.keys(sortedDeclarations), '  ');
         fs.outputFileSync(fallbackPath, fallbackData, 'utf-8');
         taskParameters.addFileToCopy(moduleInfo.outputName, 'fallback.json');
      });
      done();
   };

   const collectStyleThemes = taskParameters.metrics.createTimer('markThemeModules');
   return gulp.series(
      collectStyleThemes.start(),
      gulp.series(tasks),
      generateTaskForAddMissingThemes(taskParameters, defaultThemesContent),
      processFallbacks,
      collectStyleThemes.finish()
   );
}

function generateTaskForAddMissingThemes(taskParameters, defaultThemesContent) {
   return async function addMissingThemes() {
      const essentialThemeContent = defaultThemesContent['Controls-default-theme'];

      // essential list of themes, for now it's a list of themes in Controls-default-theme module.
      const essentialThemes = essentialThemeContent ? essentialThemeContent.themes : [];
      const promises = [];
      Object.keys(defaultThemesContent)
         .filter(currentKey => currentKey !== 'Controls-default-theme')
         .forEach((currentThemeModule) => {
            const {
               themes,
               themeName,
               sourcePath,
               modifiers,
               isThemeLess
            } = defaultThemesContent[currentThemeModule];
            const missingThemes = essentialThemes.filter(
               theme => !themes.includes(theme)
            );

            missingThemes.forEach((missingTheme) => {
               if (isThemeLess) {
                  const missingThemePath = path.join(sourcePath, missingTheme, 'theme.less');
                  const fullThemeName = `${themeName}__${missingTheme}`;
                  modifiers.push(missingTheme);
                  taskParameters.cache.setBaseThemeInfo(fullThemeName);

                  // add missing theme folder into cache for further removal from sources
                  taskParameters.cache.addMissingTheme(
                     path.dirname(missingThemePath),
                     `@import "../theme.less";\n@themeName: ${fullThemeName};`
                  );
               }
            });
         });

      await Promise.all(promises);
   };
}

module.exports = {
   generateTaskForMarkThemeModules,
   sortDeclarations
};

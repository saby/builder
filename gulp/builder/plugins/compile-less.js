/**
 * Plugin for compiling of less files
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   logger = require('../../../lib/logger').logger(),
   transliterate = require('../../../lib/transliterate'),
   execInPool = require('../../common/exec-in-pool'),
   fs = require('fs-extra'),
   pMap = require('p-map'),
   { defaultAutoprefixerOpts, defaultAutoprefixerOptsForIEApp, CURRENCY_GLYPH_MAP } = require('../../../lib/builder-constants'),
   cssExt = /\.css$/;
const PosixVinyl = require('../../../lib/platform/vinyl');

/**
 * Checks whether file should be built or skipped.
 * @param {String} relativePath - relative path from interface module root
 * @param {ModuleInfo} moduleInfo - info about current less interface module
 * @param {Object|boolean} themes - current project themes list. If true, all themes are enabled
 * in current project
 * @returns {boolean}
 */
function lessCanBeBuilt(relativePath, moduleInfo, themes) {
   // if themes checked as "true", build all of incoming less files
   if (themes && typeof themes === 'boolean') {
      return true;
   }

   // a regular less always can be built
   if (!moduleInfo.newThemesModule) {
      return true;
   }

   // dont build any less of current interface module if
   // there is no a corresponding theme in a current project
   if (!themes.hasOwnProperty(moduleInfo.themeName)) {
      return false;
   }

   // for non-array values of current theme(can be only "true" value) always build any less
   //  of current interface module
   if (themes[moduleInfo.themeName] && !themes[moduleInfo.themeName].length) {
      return true;
   }

   const relativePathParts = relativePath.split(path.sep);
   const firstName = relativePathParts[0];

   // build less if it's a root less and there is an
   // empty modifier of a current theme in a current project
   if (firstName.endsWith('.less') && themes[moduleInfo.themeName].includes('')) {
      return true;
   }

   if (themes[moduleInfo.themeName].includes(firstName) || !moduleInfo.modifiers.includes(firstName)) {
      return true;
   }

   return false;
}

function getRelativePath(modulePath, filePath) {
   return path.join(
      path.basename(modulePath),
      path.relative(modulePath, filePath)
   );
}

// заполнить мету о css-компонентах, в которых необходимо провести
// замену контента иконки под конкретный регион.
function fillRegionNodes(taskParameters, moduleName, currentRegion, currentCssNode) {
   taskParameters.cache.addRegionNode(
      moduleName,
      currentCssNode,
      currentRegion,
      '(\\.icon-currentCurrency::before\\s*{\\s*content:\\s*[\'"])(\\\\e6a3)([\'"];?\\s*})',
      `$1${CURRENCY_GLYPH_MAP[currentRegion]['\\e6a3']}$3`
   );
   taskParameters.cache.addRegionNode(
      moduleName,
      currentCssNode,
      currentRegion,
      '(\\.icon-currentCurrencyNone::before\\s*{\\s*content:\\s*[\'"])(\\\\e9cd)([\'"];?\\s*})',
      `$1${CURRENCY_GLYPH_MAP[currentRegion]['\\e9cd']}$3`
   );
}

/**
 * Plugin declaration
 * @param {TaskParameters} taskParameters a whole parameters list for execution of build of current project
 * @param {ModuleInfo} moduleInfo all needed information about current interface module
 * @param {Object} gulpModulesInfo paths to be used by less compiler for finding of imports.
 * Needed for proper work of trans-module imports
 * @returns {stream}
 */
function compileLess(taskParameters, moduleInfo, gulpModulesInfo) {
   const getOutput = function(file, replacingExt, region) {
      const relativePath = path.relative(moduleInfo.path, file.pHistory[0]).replace(/\.less$/, replacingExt);

      if (region) {
         return path.join(moduleInfo.regionOutput[region], transliterate(relativePath));
      }

      return path.join(moduleInfo.output, transliterate(relativePath));
   };

   let autoprefixerOptions = false;
   switch (typeof taskParameters.config.autoprefixer) {
      case 'boolean':
         if (taskParameters.config.autoprefixer) {
            // set default by builder autoprefixer options
            if (taskParameters.config.buildIE) {
               autoprefixerOptions = defaultAutoprefixerOptsForIEApp;
            } else {
               autoprefixerOptions = defaultAutoprefixerOpts;
            }
         } else {
            autoprefixerOptions = false;
         }
         break;
      case 'object':
         if (!(taskParameters.config.autoprefixer instanceof Array)) {
            autoprefixerOptions = taskParameters.config.autoprefixer;
         }
         break;
      default:
         break;
   }

   return through.obj(

      /* @this Stream */
      async function onTransform(file, encoding, callback) {
         try {
            if (!['.less', '.css'].includes(file.pExtname)) {
               callback(null, file);
               return;
            }

            /**
             * log information about empty less files. Developers should get
             * rid of empty and unused source files for avoiding of creating a dump
             * in theirs repos.
             */
            if (file.contents.length === 0) {
               const extension = file.pExtname.slice(1, file.pExtname.length);
               logger.warning({
                  message: `Empty ${extension} file is discovered. Please, remove it and appropriate imports of it in other less files`,
                  filePath: file.pPath,
                  moduleInfo
               });
               callback(null, file);
               return;
            }

            /**
             * private less files are used only for imports into another less, so we can
             * ignore them and return as common file into gulp stream
             */
            if (file.pBasename.startsWith('_')) {
               callback(null, file);
               return;
            }

            if (!lessCanBeBuilt(file.pRelative, moduleInfo, taskParameters.config.themes)) {
               callback(null, file);
               return;
            }

            /**
             * always ignore css source files if the same .less source files exists
             */
            if (file.pExtname === '.css') {
               const lessInSource = await fs.pathExists(file.pPath.replace(cssExt, '.less'));
               if (lessInSource) {
                  const
                     warnMessage = 'Compiled style from sources will be ignored: ' +
                        'current style will be compiled from less source analog',
                     logObj = {
                        message: warnMessage,
                        filePath: file.pPath,
                        moduleInfo
                     };

                  /**
                   * for local stands building in debug mode log existing css messages as info for debug.
                   * In other cases log it as warnings to ensure for build department to handle this
                   * messages and report an error for responsible employees
                   */
                  if (taskParameters.config.isReleaseMode) {
                     logger.warning(logObj);
                  } else {
                     logger.debug(logObj);
                  }
                  callback(null);
                  return;
               }
               callback(null, file);
               return;
            }

            let isLangCss = false;

            if (moduleInfo.contents.availableLanguage) {
               const avlLang = Object.keys(moduleInfo.contents.availableLanguage);
               isLangCss = avlLang.includes(file.pBasename.replace('.less', ''));
               file.isLangCss = isLangCss;
            }

            let relativeFilePath;
            const isThemeLess = file.pBasename === 'theme.less';
            if (moduleInfo.newThemesModule && isThemeLess) {
               let modifier = '';
               relativeFilePath = getRelativePath(moduleInfo.path, file.pHistory[0]).replace('.less', '');
               moduleInfo.modifiers.forEach((currentModifier) => {
                  // prevent situation when empty modifier passes check for current theme after the modifier was
                  // found, e.g. when modifier is "dark" , but "" modifier also pass check, we need to use "dark", then.
                  if (relativeFilePath === path.join(moduleInfo.name, currentModifier, path.sep, 'theme') && !modifier) {
                     modifier = currentModifier;
                  }
               });
               const resultThemeName = `${moduleInfo.themeName}${modifier ? `__${modifier}` : ''}`;
               taskParameters.cache.addThemePartIntoMeta(resultThemeName, relativeFilePath);
               file.themeName = resultThemeName;
            }

            const currentCssNode = `css!${moduleInfo.outputName}/${file.pRelative.replace(file.pExtname, '')}`;
            if (file.cached) {
               const outputPath = getOutput(file, '.css');
               taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);

               taskParameters.config.countries.filter(currentRegion => currentRegion !== 'RU').forEach((region) => {
                  taskParameters.cache.migrateRegionNode(moduleInfo.outputName, currentCssNode, region);
               });

               if (taskParameters.config.buildRtl) {
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputPath.replace('.css', '.rtl.css'), moduleInfo);
               }

               callback(null, file);
               return;
            }

            relativeFilePath = getRelativePath(moduleInfo.path, file.pHistory[0]);
            if (taskParameters.config.compiled && taskParameters.cache.isFirstBuild()) {
               const compiledBase = path.join(
                  taskParameters.config.compiled,
                  path.basename(moduleInfo.output)
               );
               const compiledSourcePath = path.join(
                  compiledBase,
                  file.pRelative
               );
               const compiledPath = path.join(compiledSourcePath.replace('.less', '.css'));

               // for less there is only a symlink needed to be created, so we can get a result faster
               // due to avoid read of compiled css file
               if (taskParameters.cache.compareWithCompiled(moduleInfo, relativeFilePath)) {
                  const newFile = file.clone();
                  const outputPath = getOutput(file, '.css');
                  newFile.pPath = outputPath;
                  newFile.pBase = moduleInfo.output;
                  if (!file.isLangCss) {
                     newFile.useSymlink = true;
                     newFile.origin = compiledPath;
                     newFile.compiledBase = compiledBase;
                  }
                  file.useSymlink = true;
                  this.push(newFile);

                  if (taskParameters.config.buildRtl) {
                     const outputPathForRtl = outputPath.replace('.css', '.rtl.css');

                     // also symlink compiled version for IE
                     const newFileForRtl = newFile.clone();
                     newFileForRtl.path = outputPathForRtl;
                     if (!file.isLangCss) {
                        newFileForRtl.origin = compiledPath.replace('.css', '.rtl.css');
                     }
                     this.push(newFileForRtl);
                     taskParameters.cache.addOutputFile(file.pHistory[0], outputPathForRtl, moduleInfo);
                  }

                  taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);
                  taskParameters.cache.addDependencies(
                     moduleInfo.appRoot,
                     file.pHistory[0],
                     taskParameters.cache.getCompiledDependencies(relativeFilePath) || []
                  );
                  callback(null, file);
                  return;
               }
               logger.debug(`There is no corresponding compiled file for source file: ${file.pHistory[0]}. It has to be compiled, then.`);
            }
            const [error, result] = await execInPool(
               taskParameters.pool,
               'buildLess',
               [
                  file.pHistory[0],
                  file.contents.toString(),
                  moduleInfo.newThemesModule,
                  moduleInfo.path,
                  {
                     autoprefixerOptions,
                     cssVariablesOptions: taskParameters.cache.getCssVariablesoptions(),
                     isThemeLess,
                     root: path.dirname(moduleInfo.path),
                     buildIE: !!taskParameters.config.buildIE,
                     buildRtl: !!taskParameters.config.buildRtl,
                     jsonToLess: !!taskParameters.config.jsonToLess
                  },
                  gulpModulesInfo
               ],
               file.pHistory[0],
               moduleInfo,

               /**
                * for some project in one execute machine builder can be used multiple times in parallel -
                * f.e. in offline desktop application building debug and release versions of current product.
                * In this case will be created 2x more node.js workers, than we have CPU threads in current
                * machine, that would cause "resources war" between 2 builder workerpools and significant
                * performance decrease. In this case we need extra timeout for heavy tasks
                * (less compiler is the heaviest of all builder tasks for worker)
                */
               600000
            );
            if (error) {
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
               logger.error({
                  message: 'Uncaught less compiler error',
                  error,
                  filePath: file.pHistory[0]
               });
               return;
            }

            taskParameters.metrics.storeWorkerTime('less compiler', result.timestamp);
            if (result.error) {
               if (result.type) {
                  let message = result.error;

                  // add more additional logs information for bad import in less
                  if (result.type === 'import') {
                     const errorLoadAttempts = result.error.slice(result.error.indexOf('Tried -'), result.error.length);
                     result.error = result.error.replace(errorLoadAttempts, '');

                     message = `Bad import detected ${result.error}. Check interface module of current import ` +
                        `for existing in current project. \n${errorLoadAttempts}`;
                  }
                  logger.error({
                     message,
                     filePath: result.failedLess || file.pHistory[0],
                     moduleInfo
                  });
               } else if (result.isRtlError) {
                  logger.error({
                     error: result.error,
                     filePath: file.pHistory[0],
                     moduleInfo
                  });
               } else {
                  const messageParts = [];
                  messageParts.push(`Less compiler error: ${result.error}. Source file: ${file.pHistory[0]}. `);
                  messageParts.push('\n');
                  logger.error({ message: messageParts.join('') });
               }
               taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            } else {
               const { compiled } = result;
               const outputPath = getOutput(file, '.css');
               taskParameters.config.removeFromDeletedFiles(relativeFilePath.replace('.less', '.css'));
               taskParameters.cache.addOutputFile(file.pHistory[0], outputPath, moduleInfo);

               if (taskParameters.config.buildRtl) {
                  taskParameters.cache.addOutputFile(file.pHistory[0], outputPath.replace('.css', '.rtl.css'), moduleInfo);
               }

               taskParameters.cache.addDependencies(
                  moduleInfo.appRoot,
                  file.pHistory[0],
                  compiled.imports
               );

               // для задачи регионализации иконок currentCurrency и currentCurrencyNone нам необходимо
               // сгенерить разный контент для этих 2х иконок в зависимости от региона, под который эти иконки
               // собираются, поэтому нам необходимо для одной css сгенерить 3 разных копии под каждый регион с
               // соответствующим каждому региону контентом под эти 2 иконки.
               // TODO после перевода cbuc-icons на автоматический генератор шрифта данный костыль можно
               //  будет удалить
               await pMap(
                  taskParameters.config.countries,
                  async(currentRegion) => {
                     // для RU региона ничего делать не надо, в less-исходнике и так хранится
                     // значение по умолчанию для RU региона, подмену нужно сделать для остальных
                     // требуемых регионов и только в случае, если есть замена для конкретного региона
                     // (есть регионализируемая иконка для Казахстана и Узбекистана, но нету для
                     // Туркменистана(пока что, возможно появится в будущем))
                     if (CURRENCY_GLYPH_MAP.hasOwnProperty(currentRegion)) {
                        const glyphsSourcePath = path.join(moduleInfo.appRoot, 'Controls-default-theme', 'fonts', '_glyphs.less');

                        // Если данная собранная css содержит у себя в импортах исходник с описанием иконок
                        // тогда нам надо подменить содержимое региональных иконок под значение для конкретного
                        // региона
                        if (
                           compiled.imports.includes(glyphsSourcePath) &&
                           moduleInfo.regionOutput[currentRegion]
                        ) {
                           file.hasRegionVersion = true;
                           let compiledTextForRegion = compiled.text;

                           // заполняем мету о том, в каком компоненте какие элементы css-вёрстки мы заменяем под
                           // региональное значение.
                           fillRegionNodes(taskParameters, moduleInfo.outputName, currentRegion, currentCssNode);

                           const currentRegionNodes = taskParameters.cache.getRegionNode(
                              moduleInfo.outputName,
                              currentCssNode,
                              currentRegion
                           );
                           Object.keys(currentRegionNodes).forEach((currentKey) => {
                              compiledTextForRegion = compiledTextForRegion.replace(
                                 new RegExp(currentKey),
                                 currentRegionNodes[currentKey]
                              );
                           });

                           // Если собираем мульти-сборку(передаются в сборку все доступные регионы), тогда каждую
                           // региональную иконку раскладываем по output, соответствующему конкретному региону
                           if (taskParameters.config.countries.length > 1) {
                              // к сожалению мы не можем пушить региональную cssку в основной Stream, поскольку
                              // output у этого потока настроен именно на регион по умолчанию, поэтому будем писать
                              // в региональный output напрямую через fs
                              await fs.outputFile(
                                 getOutput(file, '.css', currentRegion),
                                 Buffer.from(compiledTextForRegion)
                              );

                              // но при этом нам всё равно нужно выкинуть данную css-ку в общий stream, чтобы она прошла
                              // в дальнейшем стадию минификации
                              this.push(new PosixVinyl({
                                 pBase: moduleInfo.regionOutput[currentRegion],
                                 pPath: getOutput(file, '.css', currentRegion),
                                 contents: Buffer.from(compiledTextForRegion),
                                 region: currentRegion,
                                 hasRegionVersion: true
                              }));
                           } else {
                              // если регион 1, тогда подменяем содержимое прямо в исходной css-ке и сохраняем
                              // региональную версию стиля в качестве эталонного значения
                              compiled.text = compiledTextForRegion;
                           }
                        }
                     }
                  }
               );

               const newFile = file.clone();
               newFile.contents = Buffer.from(compiled.text);
               newFile.pPath = outputPath;
               newFile.pBase = moduleInfo.output;
               newFile.lessSource = file.contents;
               this.push(newFile);

               if (typeof compiled.textForRtl === 'string') {
                  const newFileForRtl = file.clone();
                  newFileForRtl.contents = Buffer.from(compiled.textForRtl);
                  newFileForRtl.pPath = outputPath.replace('.css', '.rtl.css');
                  newFileForRtl.pBase = moduleInfo.output;
                  newFileForRtl.lessSource = file.contents;
                  newFileForRtl.skipIndexDictionary = true;
                  this.push(newFileForRtl);
               }
            }
         } catch (error) {
            taskParameters.cache.markFileAsFailed(file.pRelativeSource(moduleInfo.path));
            logger.error({
               message: 'Builder error occurred in less compiler',
               error,
               moduleInfo,
               filePath: file.pHistory[0]
            });
         }

         callback(null, file);
      }
   );
}

module.exports = compileLess;

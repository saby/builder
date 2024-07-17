/* eslint-disable no-await-in-loop */
/**
 * Generate task for build icons fonts
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const gulp = require('gulp');
const handlePipeException = require('../../common/plugins/handle-pipe-exception');
const toPosixVinyl = require('../../common/plugins/to-posix-vinyl');
const analizeIconsPlugin = require('../plugins/analize-icons');
const logger = require('../../../lib/logger').logger();
const helpers = require('../../../lib/helpers');
const fs = require('fs-extra');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const { getHeapSizeCommand } = require('../../../lib/helpers');
const minifyCss = require('../../../lib/run-minify-css');
const getBuildStatusStorage = require('../../common/classes/build-status');
const { versionizeStyles } = require('../../../lib/versionize-content');
const PosixVinyl = require('../../../lib/platform/vinyl');
const INCLUDE_EXTENSIONS = new Set([
   '.eot',
   '.woff',
   '.woff2',
   '.css'
]);

const STYLE_TEMPLATE = `@font-face {
    font-family: "{{fontname}}";
    font-display: block;
    src: url("{{cssPath}}{{fontname}}.woff2") format("woff2"),
    url("{{cssPath}}{{fontname}}.woff") format("woff"),
    url('{{cssPath}}{{fontname}}.eot'); /* IE9*/
}
.{{fontname}} {
    font-family: '{{fontname}}' !important;
    font-size: {{fontSize}};
    font-style:normal;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
}
{{cssString}}`;

const FONT_SIZES = {
   's': 16,
   'st': 20,
   'm': 24
};

function getFontSizeValue(currentFont, isCompatibleFont) {
   const postfix = currentFont.split('_').pop();

   if (FONT_SIZES.hasOwnProperty(postfix)) {
      // для IE вставляем честное значение шрифта, в остальных случаях
      // css переменную
      if (isCompatibleFont) {
         return `${FONT_SIZES[postfix]}px`;
      }

      return `var(--icon-size_${postfix})`;
   }

   return null;
}

async function getProcessedCssText(moduleInfo, fontName, currentFile, versionEnabled, cssText, fontRoot) {
   let processedCssStyle = cssText.replace(new RegExp(`\\.${fontName}-`, 'g'), '.');
   if (!versionEnabled) {
      return processedCssStyle;
   }

   // нужно вставить плейсхолдеры версионирования и сделать ссылки на шрифты
   // совместимыми с сервисом статики
   processedCssStyle = await versionizeStyles(
      new PosixVinyl({
         pPath: path.join(moduleInfo.output, currentFile),
         pBase: moduleInfo.output,
         contents: Buffer.from(processedCssStyle),
         moduleInfo
      }),
      moduleInfo,
      { ignoreQueryParams: true, fontRoot }
   );

   return processedCssStyle.newText;
}

async function saveFontCss(taskParameters, moduleInfo, to, currentFile, processedCssStyle, minifiedCss) {
   const minCurrentFile = currentFile.replace('.css', '.min.css');

   await fs.outputFile(path.join(to, currentFile), processedCssStyle);
   await fs.outputFile(
      path.join(to, minCurrentFile),
      minifiedCss.styles
   );
   taskParameters.addVersionedModule(moduleInfo.outputName, `${moduleInfo.outputName}/${currentFile}`);
   taskParameters.addVersionedModule(moduleInfo.outputName, `${moduleInfo.outputName}/${minCurrentFile}`);
   taskParameters.addFileToCopy(moduleInfo.outputName, currentFile);
   taskParameters.addFileToCopy(moduleInfo.outputName, minCurrentFile);
}

/**
 * Moves common font artifacts to selected directory
 * @param {ModuleInfo} moduleInfo - interface module info for current file in the flow
 * @param {String} fontName current font name
 * @param {String} from directory to move from
 * @param {String} to directory to move to
 * @returns {Promise<void>}
 */
async function moveCommonFontArtifacts(taskParameters, moduleInfo, fontName, isCompatibleFont, from, to) {
   const promises = [];
   const directoryList = await fs.readdir(from);
   directoryList.forEach((currentFile) => {
      const extension = path.extname(currentFile);
      const fileName = path.basename(currentFile, extension);
      if (fileName === fontName && INCLUDE_EXTENSIONS.has(extension)) {
         if (extension === '.css') {
            const moveAndMinifyStyle = async() => {
               const sourcePath = path.join(from, currentFile);
               const cssStyle = await fs.readFile(sourcePath, 'utf8');

               const processedCssStyle = await getProcessedCssText(
                  moduleInfo,
                  fontName,
                  currentFile,
                  taskParameters.config.version,
                  cssStyle,
                  isCompatibleFont ? from : ''
               );

               const minifiedCss = minifyCss({
                  newMinimizer: true,
                  text: processedCssStyle,
                  buildIE: taskParameters.config.buildIE
               });

               if (minifiedCss.errors.length > 0) {
                  const errors = minifiedCss.errors.toString();
                  logger.warning({
                     message: `Error while minifying css: ${errors.split('; ')}`,
                     moduleInfo,
                     filePath: sourcePath
                  });
               }

               await saveFontCss(
                  taskParameters,
                  moduleInfo,
                  to,
                  currentFile,
                  processedCssStyle,
                  minifiedCss
               );

               if (taskParameters.config.buildRtl) {
                  await saveFontCss(
                     taskParameters,
                     moduleInfo,
                     to,
                     currentFile.replace('.css', '.rtl.css'),
                     processedCssStyle,
                     minifiedCss
                  );
               }
            };

            promises.push(moveAndMinifyStyle(from, to));
         } else {
            taskParameters.addFileToCopy(moduleInfo.outputName, currentFile);
            promises.push(fs.move(
               path.join(from, currentFile),
               path.join(to, currentFile),
               { overwrite: true }
            ));
         }
      }
   });
   await Promise.all(promises);
}

async function generateFontByOutput(taskParameters, moduleOutput, currentFont, fontsToGenerate, moduleInfo) {
   const fontOutput = `${moduleOutput}/temp-${currentFont}`;
   const configOutput = `${moduleOutput}/temp-${currentFont}-config`;
   const isCompatibleFont = !!fontsToGenerate[currentFont].originFontName;
   const sourceFontPath = `${moduleOutput}/${fontsToGenerate[currentFont].originFontName || currentFont}`;
   try {
      logger.debug(`Generating font for "${moduleOutput}/${currentFont}" svg files`);
      const fontSize = getFontSizeValue(currentFont, isCompatibleFont);
      const svgOptions = {
         src: sourceFontPath,
         dist: fontOutput,
         startUnicode: 0xea01,
         styleTemplates: configOutput,
         svgicons2svgfont: {

            // https://github.com/jaywcjlove/svgtofont/issues/209
            // если не выставить данный параметр, генератор шрифта
            // криво сгенерирует иконки, данный фикс позволяет нам
            // сгенерировать иконки в шрифте один в один как в исходниках
            fontHeight: 1000,

            // без этой опции иконки сьезжают вниз почти на пиксель
            normalize: true
         },
         fontName: currentFont
      };

      // плейсхолдер для RESOURCE_ROOT нужно вставлять только для основных сборок,
      // где используется сервис статики и сервис представление(исключение составляет только сборка IE,
      // где шрифты будут преобразованы в base64 и в таком случае %{RESOURCE_ROOT} не нужен.
      // В остальных случаях иконку надо оставлять с относительным путём, она сама подгрузится браузером.
      // TODO удалить в 4000 временный костыль для хоттабыча. Хоттабыч переводят на работу без сервиса статики и
      //  там нужно использовать относительные урлы до шрифтов, но чтобы в хотфикс не делать глобальную правку,
      //  сделаем фикс только для админки. В 4000 раскатаем решение глобально
      //  https://online.sbis.ru/opendoc.html?guid=8524f6b4-3f17-4c36-8a71-064bb421347a&client=3
      if (
         taskParameters.config.version &&
         taskParameters.config.multiService &&
         !isCompatibleFont &&
         !taskParameters.config.isAdminSbisRu
      ) {
         const resourceRoot = '%{RESOURCE_ROOT}';

         svgOptions.css = {
            cssPath: `${resourceRoot}${moduleInfo.outputName}/`
         };
      }

      // в IE иконки отображаются исключительно по описанию селектора иконки и указанием content
      // Пример: .icon-Test { content: '\ea01'; }
      // по другому IE отображать шрифт не может, поэтому для IE генерим данные селекторы, а для
      // остальных приложений зашиваем имя иконки в юникод.
      if (!isCompatibleFont) {
         svgOptions.useNameAsUnicode = true;
      }

      if (fontSize) {
         if (!svgOptions.css) {
            svgOptions.css = {};
         }
         svgOptions.css.fontSize = fontSize;
      }

      // svgtofont вычитывает опции автоматом из файла .svgtofontrc, который
      // расположен в cwd, из под которого запускаем соответствующую cli-команду
      await fs.outputFile(path.join(configOutput, '.svgtofontrc'), JSON.stringify(svgOptions, null, 3));

      // при включённой опции styleTemplates svgtofont вычитывает _{{filename}} файл как шаблон для генерации
      // соответствующего стиля для шрифта.
      await fs.outputFile(path.join(configOutput, '_{{filename}}.css'), STYLE_TEMPLATE);
      const processOptions = {
         maxBuffer: 1024 * 500,
         cwd: configOutput
      };

      if (!await fs.pathExists(fontOutput)) {
         await fs.mkdir(fontOutput);
      }

      // придётся вызывать svgtofont генератор через отдельный child_process, поскольку классический
      // запуск через async/await не отлавливает ошибки внутри этого генератора. Классический пример
      // вызов setTimeout внутри генератора приведёт к неотлавливаемой ошибке, можно положить весь билд
      // только из за одной кривой иконки. Вызов через отдельный child_process позволит отловить
      // любые ошибки, поскольку мы отлавливаем падение самого процесса и удобно разделить логи генерации
      // каждого шрифта между различными лог-файлами, потом проще будет анализировать ошибки
      const relativeSource = path.relative(moduleOutput, sourceFontPath);
      const fontBuildLogsPath = `${moduleOutput}/.cache/fonts/build-${currentFont}-logs.log`;
      await fs.ensureFile(fontBuildLogsPath);
      const svgtofontFlags = `--sources "../${relativeSource}" --output "../temp-${currentFont}" >> "${fontBuildLogsPath}"`;
      const heapSizeCommand = getHeapSizeCommand();
      try {
         await exec(
            `${heapSizeCommand} && node ${require.resolve('svgtofont/lib/cli')} ${svgtofontFlags}`,
            processOptions
         );
      } catch (error) {
         // пока выводим info, чтобы оценить масштаб бедствия. После можно выделить уровень WARNING и
         // выписать ответственным задачи
         const relativeLogsPath = `${moduleInfo.outputName}/.cache/fonts/build-${currentFont}-logs.log`;
         logger.info({
            message: `Error generating font. For more information, see logs ${relativeLogsPath}`,
            error,
            moduleInfo
         });

         await clearFontGeneratorArtifacts(fontOutput, configOutput);
         return;
      }

      // we can't specify specific name for demo html page in generator options
      // so rename it manually after font generate
      if (await fs.pathExists(path.join(fontOutput, 'index.html'))) {
         await fs.rename(
            path.join(fontOutput, 'index.html'),
            path.join(fontOutput, `${currentFont}.html`)
         );
      }

      // we can't specify list of artifacts to generate, so filter them and remove
      // useless artifacts(e.g. symbol.html, less files, scss file, etc.)
      await moveCommonFontArtifacts(
         taskParameters,
         moduleInfo,
         currentFont,
         isCompatibleFont,
         fontOutput,
         moduleOutput
      );
   } catch (error) {
      logger.warning({
         message: 'Error generating font',
         error,
         moduleInfo
      });
   }

   await clearFontGeneratorArtifacts(fontOutput, configOutput);
}

async function clearFontGeneratorArtifacts(fontOutput, configOutput) {
   await fs.remove(fontOutput);
   await fs.remove(configOutput);
}

function generateTaskForBuildFont(taskParameters, moduleInfo, fontsToGenerate) {
   return async function buildIconsFont() {
      if (moduleInfo.skipFontsBuild) {
         return;
      }

      for (const currentFont of Object.keys(fontsToGenerate)) {
         await generateFontByOutput(
            taskParameters,
            moduleInfo.output,
            currentFont,
            fontsToGenerate,
            moduleInfo
         );

         // если есть региональный шрифт, его также необходимо сгенерировать.
         if (fontsToGenerate[currentFont].region) {
            const { region } = fontsToGenerate[currentFont];

            await generateFontByOutput(
               taskParameters,
               moduleInfo.regionOutput[region],
               currentFont,
               fontsToGenerate,
               moduleInfo
            );
         }
      }
   };
}

function generateTaskForAnalizeIcons(taskParameters, moduleInfo, fontsToGenerate) {
   const moduleOutput = path.join(moduleInfo.output, '**/*.svg');

   return function analizeIcons(done) {
      if (moduleInfo.skipFontsBuild) {
         return done();
      }

      return gulp
         .src(moduleOutput, { dot: false, nodir: true })
         .pipe(handlePipeException('analizeIcons', taskParameters, moduleInfo))
         .pipe(toPosixVinyl())
         .pipe(analizeIconsPlugin(taskParameters, moduleInfo, fontsToGenerate))
         .pipe(gulp.dest(moduleOutput));
   };
}

function generateTaskForSaveContents(taskParameters, moduleInfo) {
   const hasLocalization = taskParameters.config.localizations.length > 0;
   if (!hasLocalization || !taskParameters.config.contents) {
      return function skipSaveContentsForFonts(done) {
         done();
      };
   }
   return async function saveContentsForFonts() {
      if (moduleInfo.skipFontsBuild) {
         return;
      }

      if (taskParameters.config.commonContents) {
         helpers.joinContents(taskParameters.config.commonContents, moduleInfo.contents);
      }
      const contentsPath = path.join(moduleInfo.output, 'contents.json');
      const sortedContents = JSON.stringify(helpers.sortObject(moduleInfo.contents));
      const contentsJsContent = helpers.generateContentsContent(
         moduleInfo.outputName,
         sortedContents,
         taskParameters.config.generateUMD
      );
      await fs.outputFile(contentsPath, sortedContents);
      await fs.outputFile(`${contentsPath}.js`, contentsJsContent);
      if (taskParameters.config.isReleaseMode) {
         await fs.outputFile(`${contentsPath}.min.js`, contentsJsContent);
      }
   };
}

function skipBuildFonts(done) {
   done();
}

function generateTaskForCacheCheck(moduleInfo) {
   return function checkIconsModuleForChanges(done) {
      if (moduleInfo.changedFiles &&
         !moduleInfo.svgChanged &&
         !getBuildStatusStorage().cacheIsDropped
      ) {
         moduleInfo.skipFontsBuild = true;
      }
      done();
   };
}

function generateTaskForBuildFonts(taskParameters) {
   if (taskParameters.config.disableFontsGenerate) {
      return skipBuildFonts;
   }
   const tasks = [];

   for (const moduleInfo of taskParameters.config.modules) {
      if (moduleInfo.compiled && typeof moduleInfo.compiled === 'boolean') {
         continue;
      }

      if (moduleInfo.icons) {
         const fontsToGenerate = {};
         tasks.push(
            gulp.series(
               generateTaskForCacheCheck(moduleInfo),
               generateTaskForAnalizeIcons(taskParameters, moduleInfo, fontsToGenerate),
               generateTaskForBuildFont(taskParameters, moduleInfo, fontsToGenerate),
               generateTaskForSaveContents(taskParameters, moduleInfo)
            )
         );
      }
   }

   if (tasks.length === 0) {
      return skipBuildFonts;
   }

   const buildFonts = taskParameters.metrics.createTimer('build icons font');
   return gulp.series(
      buildFonts.start(),
      gulp.parallel(tasks),
      buildFonts.finish()
   );
}

module.exports = generateTaskForBuildFonts;

'use strict';

const { path, toSafePosix } = require('../../lib/platform/path');
const less = require('less');
const autoprefixer = require('autoprefixer');
const postcss = require('postcss');
const postcssCssVariables = require('postcss-css-variables');
const postcssSafeParser = require('postcss-safe-parser');
const CleanCSS = require('clean-css');
const postCssDiscardDuplicates = require('postcss-discard-duplicates');
const rtlcss = require('rtlcss');
const { rebaseUrls } = require('../../packer/lib/css-helpers');
const jss = require('jss').default;
const fs = require('fs-extra');
const HAS_IE_VERSION_REGEX = /\/\*[ ]+?has-ie-version[ ]+?\*\//;

const createGenerateId = () => rule => `${rule.key}`;
jss.setup({ createGenerateId });


// options for rtlcss processor
const RTL_CSS_OPTIONS = {
   clean: false
};

// essential options for css optimizer
const CLEAN_CSS_OPTIONS = {

   /**
    * on 2nd level of optimization clean-css
    * merges css selectors and create 1 common
    * selector with a whole set of properties
    * from all merged selectors
    */
   level: 2,

   /**
    * these options are needed to get a debug
    * version of css file, it'll be minified
    * further for a release mode
    */
   format: {
      breaks: {
         afterAtRule: true,
         afterBlockBegins: true,
         afterBlockEnds: true,
         afterComment: true,
         afterProperty: true,
         afterRuleBegins: true,
         afterRuleEnds: true,
         beforeBlockEnds: true,
         betweenSelectors: true
      },
      breakWith: '\n',
      indentBy: 3,
      indentWith: 'space',
      spaces: {
         aroundSelectorRelation: true,
         beforeBlockBegins: true,
         beforeValue: true
      },
      wrapAt: false
   }
};

/**
 * Searches for all duplicate properties declaration in css selectors and choose
 * the last one of them as a result in output css result.
 * @param root - tree parsed from css via postcss processor
 */
function overrideDuplicateDeclarations(root) {
   const rootNodes = root.nodes;

   // analize every css selector of current theme
   rootNodes.forEach((currentRootNode) => {
      if (currentRootNode.type !== 'rule' || !(currentRootNode.nodes && currentRootNode.nodes.length > 0)) {
         return;
      }

      // filtered css properties without duplicates
      const formattedNodes = [];

      // meta about css properties to get last entry of each css property
      const nodePropsNames = {};

      // analyze each property of current css selector for duplicates
      currentRootNode.nodes.forEach((currentNode) => {
         if (currentNode.prop && currentNode.type === 'decl') {
            if (!nodePropsNames.hasOwnProperty(currentNode.prop)) {
               formattedNodes.push(currentNode);
               nodePropsNames[currentNode.prop] = formattedNodes.length - 1;
            } else {
               const currentPropertyLocation = nodePropsNames[currentNode.prop];
               formattedNodes[currentPropertyLocation] = currentNode;
            }
         } else {
            formattedNodes.push(currentNode);
         }
      });
      currentRootNode.nodes = formattedNodes;
   });
}

// remove all pseudo-classes(e.g. :root{})
function cleanRootClass(cssContent) {
   if (cssContent.startsWith(':root')) {
      return cssContent.replace(/:root[ ]*?\{\}\n?/g, '');
   }
   return cssContent;
}

async function getThemeJsonStyleSheet(themeJsonPath) {
   if (await fs.pathExists(themeJsonPath)) {
      const rules = await fs.readJson(themeJsonPath);

      const sheet = jss.createStyleSheet(rules);

      return sheet.toString();
   }

   return '';
}

// replace common import with its IE version if exists
function replaceImportsWithIEVersion(filePath, gulpModulesPaths, lessContent) {
   return lessContent.replace(
      /@import[ ]+?['"](.+)['"];/g,
      (match, importName) => {
         let resolvedImportPath = '';
         if (importName.startsWith('./') || importName.startsWith('../')) {
            resolvedImportPath = path.resolve(
               path.dirname(filePath),
               importName
            );
         } else {
            const importNameParts = importName.split('/');
            const moduleName = importNameParts.shift();

            if (gulpModulesPaths.hasOwnProperty(moduleName)) {
               resolvedImportPath = path.join(gulpModulesPaths[moduleName], importNameParts.join('/'));
            }
         }

         const possibleIEVersionPath = `${resolvedImportPath.replace(/\.less$/, '')}_ie.less`;

         if (fs.pathExistsSync(possibleIEVersionPath)) {
            return `@import '${possibleIEVersionPath}';`;
         }

         return match;
      }
   );
}

/**
 * get compiler result for current less and post-process it with autoprefixer.
 * @param {String} lessContent - current less content
 * @param {String} filePath - path to current less
 * @param {Object} pathsForImport - meta data for interface modules physical paths
 * @param {Object} theme - current theme meta data
 * @param {Object} imports - current less imports added by builder
 */
async function getCompiledLess(lessContent, filePath, pathsForImport, imports, postCssOptions) {
   const {
      autoprefixerOptions,
      cssVariablesOptions,
      isThemeLess,
      root,
      buildRtl,
      buildIE,
      jsonToLess
   } = postCssOptions;

   const additionalImports = [];

   let processedLessContent = lessContent;

   // если мы компилируем тему, проверяем существование с ней на одном уровне theme.json
   // генерируем из него stylesheet и добавляем в исходную less для дальнейшей компиляции.
   if (isThemeLess && jsonToLess) {
      const themeJsonPath = filePath.replace(/\.less$/, '.json');
      const additionalThemeStyleSheet = await getThemeJsonStyleSheet(themeJsonPath);

      if (additionalThemeStyleSheet) {
         processedLessContent = `${lessContent}\n${additionalThemeStyleSheet}`;

         // дополнительный импорт запишется в кэш и в случае последующих изменений в theme.json
         // билдер будет автоматически пересобирать зависимую от него тему
         additionalImports.push(themeJsonPath);
      }
   }

   const outputLess = await less.render(processedLessContent, {
      filename: filePath,
      cleancss: false,
      relativeUrls: true,
      strictImports: true,
      math: 0,

      // так предписывает делать документация для поддержки js в less
      inlineJavaScript: true,

      // а так работает на самом деле поддержка js в less
      javascriptEnabled: true,
      paths: pathsForImport
   });

   let result, resultForRtl;

   const postCssProcessors = [];
   if (autoprefixerOptions) {
      postCssProcessors.push(autoprefixer(autoprefixerOptions));
   }
   if (isThemeLess) {
      postCssProcessors.push(postCssDiscardDuplicates);
   }

   /**
    * post-process less result if there are any postcss
    * processors awaiting for css to be processed in it
    */
   if (postCssProcessors.length > 0) {
      const processor = postcss(postCssProcessors);
      const postCssResult = await processor.process(
         outputLess.css,
         {
            parser: postcssSafeParser,
            from: filePath
         }
      );
      result = postCssResult.css;
   } else {
      result = outputLess.css;
   }

   /**
    * post-process less result if there are any postcss
    * processors for rtl awaiting for css to be processed in it
    */
   try {
      if (buildRtl) {
         const rtlCssResult = buildRTLCss(outputLess.css);
         const processor = postcss(postCssProcessors);
         const postCssResult = await processor.process(
            rtlCssResult,
            {
               parser: postcssSafeParser,
               from: filePath
            }
         );
         resultForRtl = postCssResult.css;
      }
   } catch (error) {
      let erroredCssCode = '';
      if (error.line) {
         const cssParts = outputLess.css.split('\n');
         for (let i = error.line - 4; i <= error.line + 4; i++) {
            erroredCssCode += `${i}: ${cssParts[i]}\n`;
         }
      }

      const resultError = new Error(`Error during rtl css generator: ${error.message} Css code:\n${erroredCssCode}`);
      resultError.isRtlError = true;
      throw resultError;
   }

   /**
    * It's essential css optimizer for themes styles
    * that uses to merge equal css selectors and get rid of
    * duplicates - css selectors has equal names and about
    * 80% properties in common, but 20% differs, therefore about
    * 80% of css content is useless and can be removed to optimize
    * loading of styles on a client side.
    */
   if (isThemeLess) {
      const compiled = new CleanCSS(CLEAN_CSS_OPTIONS).minify(Buffer.from(result));
      let errors = [];
      if (compiled.errors.length) {
         errors = [...compiled.errors];
      }

      if (compiled.warnings.length) {
         errors = [...errors, ...compiled.warnings];
      }
      if (errors.length > 0) {
         throw new Error(`Theme optimizing was completed with errors: ${errors}`);
      } else {
         result = compiled.styles;
      }

      try {
         // remove property duplicates that have different value(choose the last one of them as a result)
         const processor = postcss([postcss.plugin('override css duplicates', () => overrideDuplicateDeclarations)]);
         const postCssResult = await processor.process(
            result,
            {
               parser: postcssSafeParser,
               from: filePath
            }
         );
         result = postCssResult.css;
      } catch (error) {
         throw new Error(`There was a problem with theme optimization of properties duplicates: ${error.message} \n Stack: ${error.stack}`);
      }

      // rebase all relative css url to
      // properly for further usages from final theme
      // destination
      result = rebaseUrls({
         root,
         sourceFile: filePath,
         css: result,
         relativePackagePath: 'themeName.css',
         resourcesUrl: '%{RESOURCE_ROOT}'
      });
   }

   if (cssVariablesOptions && buildIE) {
      const processor = postcss([postcssCssVariables(cssVariablesOptions)]);
      const postCssResult = processor.process(
         result,
         {
            parser: postcssSafeParser,
            from: filePath
         }
      );
      result = postCssResult.css;
   }

   result = cleanRootClass(result);
   if (buildIE) {
      result = cleanRootClass(result);
   }
   if (resultForRtl) {
      resultForRtl = cleanRootClass(resultForRtl);
   }

   return {
      text: result,
      textForRtl: resultForRtl,
      imports: [...outputLess.imports, ...additionalImports].map(currentPath => toSafePosix(currentPath))
   };
}

/**
 * check current file to be an old theme less(f.e. online.less, carry.less, etc.)
 * @param filePath
 * @param theme
 * @returns {Sinon.SinonMatcher | * | boolean}
 */
function isOldThemeLess(filePath, theme) {
   const relativeThemePath = `${path.join(theme.path, theme.name)}.less`;
   return filePath.endsWith(relativeThemePath);
}

/**
 * Returns imports from builder for current less.
 * build less files without any extra imports from builder in next cases:
 * 1) for new themes
 * 2) for old theme less building(f.e. online.less, presto.less, etc.)
 * @param filePath
 * @param theme
 * @param gulpModulesPaths
 * @returns {Array}
 */
function getCurrentImports(filePath, themeProps, gulpModulesPaths) {
   const { newThemesModule, theme } = themeProps;
   if (!theme) {
      return [];
   }

   /**
    * theme object can be defined without path for it. Example - default theme resolved as 'online'(for old theme build
    * theme resolves to online as default), but interface module 'SBIS3.CONTROLS'(source of theme online) doenst exists
    * in current project.
    */
   if (newThemesModule) {
      return [];
   }

   if (isOldThemeLess(filePath, theme)) {
      return [];
   }

   const imports = [];

   if (filePath.includes('temp-modules/SBIS3.CONTROLS/')) {
      imports.push("@import 'SBIS3.CONTROLS/themes/online/_variables';");
   } else if (gulpModulesPaths.hasOwnProperty('Controls-default-theme')) {
      imports.push("@import 'Controls-default-theme/_new-mixins';");
      imports.push("@import 'Controls-default-theme/_mixins';");
   }

   if (gulpModulesPaths.hasOwnProperty('SBIS3.CONTROLS')) {
      imports.push('@import "SBIS3.CONTROLS/themes/_mixins";');
   }

   imports.push(`@themeName: ${theme.name};`);

   return imports;
}

async function processLessFile(
   data,
   filePath,
   themeProps,
   gulpModulesInfo,
   postCssOptions = {
      autoprefixerOptions: {}, cssVariablesOptions: {}, isThemeLess: false
   }
) {
   const { pathsForImport, gulpModulesPaths } = gulpModulesInfo;

   let newData = data;
   if (HAS_IE_VERSION_REGEX.test(data) && postCssOptions.buildIE) {
      newData = replaceImportsWithIEVersion(filePath, gulpModulesPaths, newData);
   }

   const imports = getCurrentImports(filePath, themeProps, gulpModulesPaths);

   newData = [...imports, ...[newData]].join('\n');
   let lessResult;
   try {
      lessResult = await getCompiledLess(newData, filePath, pathsForImport, imports, postCssOptions);
   } catch (error) {
      if (error instanceof less.LessError) {
         // error.line может не существовать.
         let errorLineStr = '';
         if (error.hasOwnProperty('line') && typeof error.line === 'number') {
            let errorLine = error.line;
            const errorColumn = error.column;
            if (
               toSafePosix(error.filename) === toSafePosix(filePath) &&
               errorLine >= imports.length
            ) {
               // сколько строк добавили в файл, столько и вычтем для вывода ошибки
               // в errorLine не должно быть отрицательных значений.
               errorLine -= imports.length;
            }
            errorLineStr = ` line ${errorLine}, column ${errorColumn}`;
         }

         /**
          * file that has failed to be imported isn't existing in current error only
          * if less compiler have failed by itself
          */
         if (!error.filename) {
            return {
               error: error.message,
               compilerError: true
            };
         }

         if (error.type === 'File') {
            return {
               error: `${errorLineStr}: ${error.message} \n importsList: ${imports}`,
               failedLess: error.filename,
               type: 'import'
            };
         }

         /**
          * error.filename can be somewhere in less files to be imported.
          * Therefore there is unique information for each failed less.
          */
         let message = 'Error compiling less ';
         message += `: ${errorLineStr}: ${error.message} Needed by ${filePath} importsList: ${imports}`;
         return {
            error: message,
            failedLess: error.filename,
            type: 'common'
         };
      }
      if (error.isRtlError) {
         return {
            error,
            isRtlError: true
         };
      }
      throw error;
   }
   return lessResult;
}

function buildRTLCss(css) {
   return rtlcss.process(css, RTL_CSS_OPTIONS, [
      {
         name: 'shadow',
         priority: 99,
         directives: {
            control: {},
            value: []
         },
         processors: [
            {
               expr: /^(box|text)-shadow/ig,
               action: rtlCssPluginForShadowOptions
            }
         ]
      }
   ]);
}

function rtlCssPluginForShadowOptions(prop, value, context) {
   const calcAndNumber = context.util.regex(['calc', 'number']);
   const colorSafe = context.util.guardHexColors(value);
   const funcSafe = context.util.guardFunctions(colorSafe.value);

   funcSafe.value = funcSafe.value.replace(/[^,]+/g, (shadow) => {
      const args = shadow.split(' ');

      if (args.length < 3) {
         return shadow;
      }

      for (const arg of shadow.split(' ')) {
         if (arg.startsWith(`var${funcSafe.token}`)) {
            funcSafe.store.push(`(${arg})`);

            const newCalc = `calc${funcSafe.token}:${funcSafe.store.length}\u00BB`;

            funcSafe.value = funcSafe.value.replace(arg, newCalc);

            return context.util.negate(shadow.replace(arg, newCalc));
         }

         if (calcAndNumber.test(arg)) {
            break;
         }
      }

      return context.util.negate(shadow);
   });

   colorSafe.value = context.util.unguardFunctions(funcSafe);

   return { prop, value: context.util.unguardHexColors(colorSafe) };
}

module.exports = {
   getCurrentImports,
   processLessFile,
   buildRTLCss
};

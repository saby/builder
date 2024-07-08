/* eslint-disable no-bitwise */
'use strict';

const CleanCSS = require('clean-css');
const { Features, transform, browserslistToTargets } = require('lightningcss');
const browserslist = require('browserslist');
const { supportedBrowsers } = require('./builder-constants');

const defaultOptions = {
   advanced: false,
   aggressiveMerging: false,
   compatibility: 'ie8',
   inliner: false,
   keepBreaks: false,
   keepSpecialComments: '*',
   mediaMerging: false,
   processImport: false,
   rebase: false,
   restructuring: false,
   roundingPrecision: 2,
   sourceMap: false
};

const deepOptimizeOptions = {

   /**
    * on 2nd level of optimization clean-css
    * merges css selectors and create 1 common
    * selector with a whole set of properties
    * from all merged selectors. It'll remove all
    * duplicates with the same set of properties
    */
   level: {
      2: {
         all: false,
         mergeAdjacentRules: true,
         removeEmpty: true
      }
   }
};

const LIGHTNINGCSS_OPTIONS = {
   include: (
      Features.Nesting |
      Features.NotSelectorList |
      Features.DirSelector |
      Features.LangSelectorList |
      Features.IsSelector |

      Features.TextDecorationThicknessPercent |
      Features.ClampFunction |
      Features.FontFamilySystemUi |
      Features.DoublePositionGradients |

      // без данной настройки минификатор превратит набор top bottom right и left набор параметров
      // css селектора в inset, который не поддерживается в 76м хроме.
      Features.LogicalProperties |

      // без данных опций @media range преобразуется в конструкцию, которая не поддерживается в 76
      // хроме. Например
      // @media (max-width: 1400px) { ... }
      // будет минифицирован в
      // @media (width<=1400px){...}
      Features.MediaIntervalSyntax |
      Features.MediaRangeSyntax
   ),
   exclude: (
      Features.CustomMediaQueries |

      Features.ColorFunction |
      Features.OklabColors |
      Features.LabColors |
      Features.P3Colors |
      Features.HexAlphaColors |
      Features.SpaceSeparatedColorNotation
   ),
   minify: true,
   targets: browserslistToTargets(browserslist(supportedBrowsers))
};

function runMinifyCss(newMinimizer, text, deepOptimize) {
   const startTime = Date.now();

   const minifyOptions = deepOptimize ? { ...defaultOptions, ...deepOptimizeOptions } : defaultOptions;
   let compiled;

   let errors = [];

   // новый минификатор минифицирует код по максимуму и не имеет гибкой настройки, в результате
   // чего некоторый старый legacy код минифицируется некорректно и ломает вёрстку. Управлять этим
   // на текущий день не представляется возможным, есть открытое issue на github на гибкую настройку
   // минификатора, после его выполнения можно будет донастроить lightningcss для работы с legacy-кодом.
   // TODO перевести на lightningcss все оставшиеся css, как только разработчики поддержат гибкую настройку
   //  минификатора https://github.com/parcel-bundler/lightningcss/issues/666
   //  https://online.sbis.ru/opendoc.html?guid=3362309a-8904-44b4-901e-4f6e9672919c&client=3
   if (newMinimizer) {
      try {
         compiled = transform({
            ...LIGHTNINGCSS_OPTIONS,
            code: Buffer.from(text)
         });
      } catch (err) {
         // у новой библиотеки происходит парсинг css-кода и могут возникать ошибки в legacy-коде
         // пока делаем warning на такие ошибки, чтобы запустить процесс исправления.
         // TODO После исправления всех ошибок удалить использование старого минификатора clean-css
         //  https://online.sbis.ru/opendoc.html?guid=c8ea15ec-bbf4-4570-b2da-8900f135adb7&client=3
         errors.push(err);

         compiled = new CleanCSS(minifyOptions).minify(text);
      }
   } else {
      compiled = new CleanCSS(minifyOptions).minify(text);
   }

   if (compiled.errors && compiled.errors.length) {
      const normalizedErrors = compiled.errors.map((currentError) => {
         if (typeof currentError === 'object') {
            return `${currentError.message}${currentError.loc ? ` at ${currentError.loc.line}:${currentError.loc.column}` : ''}`;
         }
         return currentError;
      });
      errors = [...errors, ...normalizedErrors];
   }

   if (compiled.warnings.length) {
      const normalizedWarnings = compiled.warnings.map((currentError) => {
         if (typeof currentError === 'object') {
            return `${currentError.message}${currentError.loc ? ` at ${currentError.loc.line}:${currentError.loc.column}` : ''}`;
         }
         return currentError;
      });
      errors = [...errors, ...normalizedWarnings];
   }

   let compiledCssString;

   // lightningcss выдаёт результат в параметре code, а CleanCSS в параметре styles.
   const compiledStyles = compiled && (compiled.code || compiled.styles);
   if (errors.length > 0) {
      compiledCssString = compiledStyles ? `/*${errors}*/${compiledStyles.toString()}` : '';
   } else {
      compiledCssString = compiledStyles.toString();
   }

   return {
      styles: compiledCssString,
      errors,
      timestamp: {
         start: startTime,
         finish: Date.now()
      }
   };
}

module.exports = runMinifyCss;

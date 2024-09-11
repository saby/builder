'use strict';

// converts decimal value to hex
const hsl = require('hsl-to-hex');
const MAX_VALUE = 255;
const { default: jss } = require('jss');
const createGenerateId = () => rule => `${rule.key}`;
jss.setup({ createGenerateId });

function decimalToHexString(decimal) {
   const hex = Math.trunc(decimal).toString(16);

   if (hex.length < 2) {
      return `0${hex}`;
   }
   return hex;
}

// конвертируем HEX значение в HEXA
function getHexWithAlpha(params) {
   const {
      hue,
      saturation,
      luminosity,
      alpha
   } = params;
   const decimalAlpha = MAX_VALUE * alpha;
   const hex = hsl(hue, saturation, luminosity);

   if (decimalAlpha === MAX_VALUE) {
      return hex.toUpperCase();
   }

   return `${hex}${decimalToHexString(decimalAlpha)}`.toUpperCase();
}

// парсим тему в формате sabytheme в удобный для нас json-формат, чтобы на основе
// его было удобно генерировать css-контент
function parseTheme(fileName, jsonContent) {
   const { body } = jsonContent[0];
   const result = {
      id: body.id,
      title: body.title,
      selector: body.selector,
      fileName
   };

   result.selector = body.selector;

   // если у темы есть родитель, указываем
   result.parent = body.parent;

   body.styles.forEach((currentStyle) => {
      if (!result.styles) {
         result.styles = {};
      }
      const currentProperties = {};
      currentStyle.properties.forEach((currentProperty) => {
         currentProperties[currentProperty.key] = {
            value: currentProperty.values[0].value
         };

         if (currentProperty.values[0].valuelinks) {
            [currentProperties[currentProperty.key].valuelinks] = currentProperty.values[0].valuelinks;
         }
      });

      result.styles[currentStyle.selector] = currentProperties;
   });

   if (body.overrides) {
      const currentOverrides = {};

      Object.keys(body.overrides).forEach((currentTheme) => {
         const currentOverride = body.overrides[currentTheme];

         Object.keys(currentOverride).forEach((currentSelector) => {
            if (!currentOverrides[currentSelector]) {
               currentOverrides[currentSelector] = {};
            }

            const currentProperties = currentOverride[currentSelector];
            Object.keys(currentProperties).forEach((currentProperty) => {
               currentOverrides[currentSelector][currentProperty] = currentProperties[currentProperty];
            });
         });
      });

      result.overrides = currentOverrides;
   }

   if (!result.styles) {
      result.styles = {};
   }

   return result;
}

function getResultByPercent(value, percent) {
   return value + (value * percent) / 100;
}

// рекурсивно определяем hsla параметры данной переменной с учетом родительских css-переменных
// и их hsla-параметров. Вычисление происходит по следующим правилам:
// 1) hue - всегда берётся из родительского элемента(если цепочка родителей, то из самого корня)
// 2) alpha - всегда берётся из текущего элемента
// 3) saturation и luminosity:
// 3.1) в режиме strict true берём их из текущего элемента.
// 3.2) в режиме strict false мы должны получить для них такие значения:
// parent_param + (parent_param * child_param) / 100
function getHslParams(currentProperties, currentMeta) {
   const currentValue = currentMeta.value;

   const alpha = currentValue.a;
   if (currentMeta.valuelinks && currentProperties[currentMeta.valuelinks]) {
      const parentParams = getHslParams(currentProperties, currentProperties[currentMeta.valuelinks]);
      const hue = parentParams.h;

      let saturation, luminosity;
      if (currentValue.strict) {
         saturation = currentValue.s;
         luminosity = currentValue.l;
      } else {
         saturation = getResultByPercent(parentParams.s, currentValue.s);
         luminosity = getResultByPercent(parentParams.l, currentValue.l);
      }

      return {
         h: hue,
         s: saturation,
         l: luminosity,
         a: alpha
      };
   }

   return {
      h: currentValue.h,
      s: currentValue.s,
      l: currentValue.l,
      a: alpha
   };
}

// конвертируем json-мету описания темы в css-контент
function convertSabyThemeMetaToCss(currentThemeMeta) {
   const jsonCss = {};

   Object.keys(currentThemeMeta.styles).forEach((currentStyle) => {
      const selectorName = `t-${currentThemeMeta.selector}.${currentStyle}`;

      if (!jsonCss[selectorName]) {
         jsonCss[selectorName] = {};
      }

      const currentProperties = currentThemeMeta.styles[currentStyle];

      Object.keys(currentProperties).forEach((currentProperty) => {
         const currentPropertyMeta = currentProperties[currentProperty];

         const hexOptions = getHslParams(currentProperties, currentPropertyMeta);
         jsonCss[selectorName][`--${currentProperty}`] = getHexWithAlpha(
            {
               hue: hexOptions.h,
               saturation: hexOptions.s,
               luminosity: hexOptions.l,
               alpha: hexOptions.a
            }
         );
      });
   });
   const result = jss.createStyleSheet(jsonCss).toString();

   return result.replace(new RegExp(`.t-${currentThemeMeta.selector}\\\\`, 'g'), `.t-${currentThemeMeta.selector}`);
}

// получаем мета-данные о сконвертированной saby-теме.
// json формата { styles: ['t-<селектор темы>', <перечисление всех остальных селекторов>]
function getJsonMetaForSabyTheme(currentThemeMeta) {
   const result = {
      styles: [`t-${currentThemeMeta.selector}`]
   };

   Object.keys(currentThemeMeta.styles).forEach(currentStyle => result.styles.push(currentStyle));

   return result;
}

// рекурсивно определяем список 'нетронутых' css-переменных родителей и переопределяем
// все переменные, описанные в overrides. Функция учитывает родительские overrides
function recursiveResolveThemeOverrides(sabyThemes, processedThemes, currentThemeMeta) {
   if (!currentThemeMeta) {
      return null;
   }

   const result = { ...currentThemeMeta };

   if (result.parent && result.parent.id) {
      let parentResult;

      if (processedThemes[result.parent.id]) {
         parentResult = processedThemes[result.parent.id];
      } else {
         parentResult = recursiveResolveThemeOverrides(sabyThemes, processedThemes, sabyThemes[result.parent.id]);
      }


      if (!parentResult) {
         const currentThemeMessage = `Theme with id "${result.parent.id}" and name "${result.parent.title}" isn't found.`;
         const neededByMessage = `Needed by theme with id "${result.id}" and name "${result.title}"`;
         throw new Error(`${currentThemeMessage} ${neededByMessage}`);
      }

      Object.keys(parentResult.styles).forEach((selector) => {
         const currentProperties = parentResult.styles[selector];
         const currentOverrides = result.overrides[selector];

         // если не переопределяется ни одна переменная селектора, значит из родителя достаём весь селектор
         // целиком
         if (!result.overrides[selector]) {
            result.styles[selector] = { ...parentResult.styles[selector] };
         } else {
            if (!result.styles[selector]) {
               result.styles[selector] = {};
            }

            Object.keys(currentProperties).forEach((property) => {
               if (currentOverrides[property]) {
                  result.styles[selector][property] = currentOverrides[property];
               } else {
                  result.styles[selector][property] = parentResult.styles[selector][property];
               }
            });
         }
      });
   }

   return result;
}

// функция, которая для каждой темы рекурсивно по родителям достаёт список 'нетронутых'
// css-переменных и переопределяет указанные в overrides
function getProcessedThemes(sabyThemes) {
   const result = {};

   Object.keys(sabyThemes).forEach((currentTheme) => {
      const currentThemeMeta = sabyThemes[currentTheme];
      if (!currentThemeMeta.overrides) {
         result[currentTheme] = currentThemeMeta;
      } else {
         result[currentTheme] = recursiveResolveThemeOverrides(sabyThemes, result, currentThemeMeta);
      }
   });

   return result;
}

module.exports = {
   getHslParams,
   getProcessedThemes,
   convertSabyThemeMetaToCss,
   parseTheme,
   getHexWithAlpha,
   getJsonMetaForSabyTheme
};

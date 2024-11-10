'use strict';
const initTest = require('./init-test');

const {
   getHslParams,
   parseTheme,
   getProcessedThemes,
   convertSabyThemeMetaToCss,
   getHexWithAlpha,
   getJsonMetaForSabyTheme
} = require('../lib/process-sabytheme');
const { expect } = require('chai');
const { path, toPosix } = require('../lib/platform/path');
const fs = require('fs-extra');
const dirname = toPosix(__dirname);
const pMap = require('p-map');

async function prepareSabyThemes(moduleFolder) {
   const result = {};
   const files = (await fs.readdir(moduleFolder)).filter(fileName => fileName.endsWith('.sabytheme'));

   await pMap(
      files,
      async(fileName) => {
         const fileContent = await fs.readJson(path.join(moduleFolder, fileName));
         const parsedTheme = parseTheme(fileName, fileContent);

         result[parsedTheme.id] = parsedTheme;
      }
   );

   return result;
}

describe('process sabytheme', () => {
   const moduleFolder = path.join(dirname, 'fixture/process-sabytheme/TestModule');

   before(async() => {
      await initTest();
   });

   describe('get hsl params', () => {
      it('check params for variable without inheritance', () => {
         const currentProperties = {
            'primary_color': {
               light: {
                  value: {
                     a: 1,
                     h: 17.74194,
                     l: 60,
                     s: 91.17647
                  }
               }
            }
         };

         const result = getHslParams('', currentProperties, currentProperties.primary_color, 'light');

         expect(result).to.deep.equal(currentProperties.primary_color.light.value);
      });

      it('check params for variable with inheritance in strict mode', () => {
         const currentProperties = {
            'primary_color': {
               light: {
                  value: {
                     a: 1,
                     h: 17.74194,
                     l: 60,
                     s: 91.17647
                  }
               }
            },
            'primary_text-color': {
               light: {
                  value: {
                     a: 1.0,
                     h: 0.0,
                     l: -21.0,
                     s: -34.0,
                     strict: true
                  },
                  valuelinks: ['primary_color']
               }
            }
         };

         const result = getHslParams('', currentProperties, currentProperties['primary_text-color'], 'light');

         expect(result).to.deep.equal({
            a: 1,
            h: 17.74194,
            l: -21,
            s: -34
         });
      });

      it('check params for variable with inheritance with disabled strict mode', () => {
         const currentProperties = {
            'primary_color': {
               light: {
                  value: {
                     a: 1,
                     h: 17.74194,
                     l: 60,
                     s: 91.17647
                  }
               }
            },
            'primary_text-color': {
               light: {
                  value: {
                     a: 1.0,
                     h: 0.0,
                     l: -21.0,
                     s: -34.0,
                     strict: false
                  },
                  valuelinks: ['primary_color']
               }
            }
         };

         const result = getHslParams('', currentProperties, currentProperties['primary_text-color'], 'light');

         // в режиме strict false мы должны получить для l и s такие значения:
         // parent_param + (parent_param * child_param) / 100
         expect(result).to.deep.equal({
            a: 1.0,
            h: 17.74194,
            l: 47.4,
            s: 60.1764702
         });
      });

      it('check params for variable with multiple inheritance with disabled strict mode', () => {
         const currentProperties = {
            'primary_color': {
               light: {
                  value: {
                     a: 1,
                     h: 17.74194,
                     l: 60,
                     s: 91.17647
                  }
               }
            },
            'primary_text-color': {
               light: {
                  value: {
                     a: 1.0,
                     h: 0.0,
                     l: -21.0,
                     s: -34.0,
                     strict: false
                  },
                  valuelinks: ['primary_color']
               }
            },
            'primary_hover_text-color': {
               light: {
                  value: {
                     a: 1.0,
                     h: 0.0,
                     l: -11.0,
                     s: 112.0,
                     strict: false
                  },
                  valuelinks: ['primary_text-color']
               }
            }
         };

         const result = getHslParams('', currentProperties, currentProperties['primary_hover_text-color'], 'light');

         // в режиме strict false мы должны получить для l и s такие значения:
         // parent_param + (parent_param * child_param) / 100
         // при мульти наследовании рекурсивно вычисляем сначала значение для всех предков
         // и только после этого вычисляем значение текущего проперти
         expect(result).to.deep.equal({
            a: 1.0,
            h: 17.74194,
            l: 42.186,
            s: 127.574116824
         });
      });
   });

   it('get correct parsed meta of sabytheme', async() => {
      const sabyThemes = await prepareSabyThemes(moduleFolder);
      const checkThemeVariablesList = (objectToCheck, variablesToCheck) => {
         expect(Object.keys(objectToCheck)).to.have.members(variablesToCheck);
      };
      const testResults = (themes) => {
         const themesIdList = [
            'base_sabytheme',
            'default_sabytheme',
            'blackblue_sabytheme'
         ];

         // проверяем что все указанные темы успешно распарсились
         expect(Object.keys(themes)).to.have.members(themesIdList);

         // проверим что у всех 3-х тем есть все нужные стили
         const variablesToCheck = ['primary_color', 'primary_text-color', 'primary_hover_text-color'];
         themesIdList.forEach((currentTheme) => {
            checkThemeVariablesList(
               sabyThemes[currentTheme].styles.primary_color,
               variablesToCheck
            );
         });

         // проверим, что при наследовании тем произошло правильное переопределение нужных стилей
         expect(
            sabyThemes.base_sabytheme.styles.primary_color.primary_color
         ).to.deep.equal({
            light: {
               value: {
                  a: 1,
                  h: 17.74194,
                  l: 60,
                  s: 91.17647,
                  strict: false
               }
            },
            dark: {
               value: {
                  a: 1,
                  h: 17.74194,
                  l: 60,
                  s: 91.17647,
                  strict: false
               }
            }
         });

         // у дефолтной темы должна быть переопределена переменная "primary_color",
         // а остальные должны взяться из темы "base"
         expect(
            sabyThemes.default_sabytheme.styles.primary_color.primary_color
         ).to.deep.equal({
            light: {
               value: {
                  a: 1,
                  h: 18,
                  l: 60,
                  s: 100,
                  strict: false
               }
            },
            dark: {
               value: {
                  a: 1,
                  h: 18,
                  l: 60,
                  s: 100,
                  strict: false
               }
            }
         });
         expect(
            sabyThemes.default_sabytheme.styles.primary_color['primary_text-color'].light.value
         ).to.deep.equal(
            sabyThemes.base_sabytheme.styles.primary_color['primary_text-color'].light.value
         );
         expect(
            sabyThemes.default_sabytheme.styles.primary_color['primary_hover_text-color'].light.value
         ).to.deep.equal(
            sabyThemes.base_sabytheme.styles.primary_color['primary_hover_text-color'].light.value
         );

         // у темы "blackblue" переопределяется переменная "primary_text-color", переменная "primary_color"
         // должна взяться как переопределённая из родительской темы "default", а переменная
         // "primary_hover_text-color" из темы "base", поскольку её никто не переопределял
         expect(
            sabyThemes.blackblue_sabytheme.styles.primary_color['primary_text-color'].light.value
         ).to.deep.equal({
            a: 1,
            h: 185.454545454545,
            l: 8.62745098039216,
            s: 100,
            strict: false
         });
         expect(
            sabyThemes.blackblue_sabytheme.styles.primary_color.primary_color.light.value
         ).to.deep.equal(
            sabyThemes.default_sabytheme.styles.primary_color.primary_color.light.value
         );
         expect(
            sabyThemes.blackblue_sabytheme.styles.primary_color['primary_hover_text-color'].light.value
         ).to.deep.equal(
            sabyThemes.base_sabytheme.styles.primary_color['primary_hover_text-color'].light.value
         );
      };

      const result = getProcessedThemes(sabyThemes);

      testResults(result);
   });

   describe('get hex by hsla params', () => {
      const hslParams = {
         hue: 17.74194,
         luminosity: 60.0,
         saturation: 91.17647
      };

      it('return hex value if alpha equals 100%', () => {
         const params = { ...hslParams, alpha: 1.0 };

         const result = getHexWithAlpha(params);

         expect(result).to.be.equal('#F6733C');
      });

      it('return hexa value if alpha less 100%', () => {
         const params = { ...hslParams, alpha: 0.5 };

         const result = getHexWithAlpha(params);

         expect(result).to.be.equal('#F6733C7F');
      });
   });

   it('convert sabytheme to css', async() => {
      const sabyThemes = getProcessedThemes((await prepareSabyThemes(moduleFolder)));

      const result = convertSabyThemeMetaToCss(sabyThemes.base_sabytheme);

      expect(result).to.be.equal('.t-base.primary_color.t-light, .t-base.primary_color .t-light {\n' +
         '  --primary_color: #F6733C;\n' +
         '  --primary_text-color: #C25B30;\n' +
         '  --primary_hover_text-color: #D74000;\n' +
         '}\n' +
         '.t-base.primary_color {\n' +
         '  --primary_color: #F6733C;\n' +
         '  --primary_text-color: #C25B30;\n' +
         '  --primary_hover_text-color: #D74000;\n' +
         '}\n' +
         '.t-base.primary_color.t-dark, .t-base.primary_color .t-dark {\n' +
         '  --primary_color: #F6733C;\n' +
         '  --primary_text-color: #C25B30;\n' +
         '  --primary_hover_text-color: #D74000;\n' +
         '}');
   });

   it('get correct json meta for css sabytheme', async() => {
      const sabyThemes = getProcessedThemes((await prepareSabyThemes(moduleFolder)));

      const result = getJsonMetaForSabyTheme(sabyThemes.blackblue_sabytheme);

      expect(result).to.deep.equal({
         styles: ['t-default__blackblue', 'test_color', 'primary_color']
      });
   });
});

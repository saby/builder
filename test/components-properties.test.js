/* eslint-disable no-unused-expressions */
'use strict';

const { expect } = require('chai');

const {
   filterTypeValue,
   filterComponentOptions,
   filterComponentProperties
} = require('../lib/components-properties');

const deepClone = value => JSON.parse(JSON.stringify(value));

function toComponentData(options) {
   return {
      properties: {
         'ws-config': {
            options
         }
      }
   };
}

function putUnnecessaryFlags(options) {
   for (const optionName in options) {
      if (!options.hasOwnProperty(optionName)) {
         continue;
      }

      options[optionName].title = 'unspecified default';
      options[optionName].default = 'unspecified default';

      for (const flagName of ['itemType', 'arrayElementType']) {
         if (options[optionName].hasOwnProperty(flagName)) {
            options[optionName][flagName] = `${options[optionName][flagName]}|String|null`;
         }
      }
   }

   return options;
}

function putUnnecessaryOption(options) {
   options.unnecessary = {
      type: 'String'
   };

   return options;
}

function putUnnecessaryComponents(componentOptions) {
   for (const componentName of ['FirstUnnecessary/empty', 'SecondUnnecessary/empty.typedef']) {
      componentOptions[componentName] = toComponentData(putUnnecessaryOption({}));
   }
}

function putUnnecessaryComponentData(componentOptions) {
   for (const componentName in componentOptions) {
      if (!componentOptions.hasOwnProperty(componentName)) {
         continue;
      }

      componentOptions[componentName].name = componentName;
      componentOptions[componentName].title = 'unspecified title';
      componentOptions[componentName].isPublic = true;

      if (!componentOptions[componentName].hasOwnProperty('properties')) {
         componentOptions[componentName].properties = { };
      }

      componentOptions[componentName].properties['ws-handlers'] = {
         title: 'unspecified title',
         options: {
            onEvent: {
               title: 'unspecified title',
               editor: 'handler',
               params: ['p1', 'p2']
            }
         }
      };

      componentOptions[componentName].sourceFiles = ['file.js'];
   }
}

function getRawOptions(expectedOptions) {
   const rawInput = deepClone(expectedOptions);

   putUnnecessaryOption(rawInput);
   putUnnecessaryFlags(rawInput);

   return rawInput;
}

function getRawComponentOptions(componentOptions) {
   const rawInput = deepClone(componentOptions);

   putUnnecessaryComponents(rawInput);
   putUnnecessaryComponentData(rawInput);

   return rawInput;
}

describe('lib/components-properties', () => {
   describe('filterTypeValue', () => {
      it('should remove primitive types', () => {
         const typeValue = 'Boolean|Date|Number|Object|String|function';

         expect(filterTypeValue(typeValue)).to.be.empty;
      });
      it('should remove primitive values', () => {
         const typeValue = 'true|false|null|undefined';

         expect(filterTypeValue(typeValue)).to.be.empty;
      });
      it('should keep particular type', () => {
         const particularType = 'Module/lib:File';
         const typeValue = `${particularType}|String`;

         expect(filterTypeValue(typeValue)).equals(particularType);
      });
      it('should keep particular typedef type', () => {
         const particularType = 'Module/File.typedef';
         const typeValue = `${particularType}|String`;

         expect(filterTypeValue(typeValue)).equals(particularType);
      });
      it('should keep required types for xhtml localization', () => {
         const particularType = 'Array|content';
         const typeValue = `Number|${particularType}|String`;

         expect(filterTypeValue(typeValue)).equals(particularType);
      });
   });
   describe('filterComponentOptions', () => {
      it('should not return anything', () => {
         const rawInput = getRawOptions({
            first: {},
            second: {},
            third: {}
         });

         expect(filterComponentOptions(rawInput)).to.be.undefined;
      });
      it('should keep translatable option', () => {
         const expectedOptions = {
            translatableOption: {
               translatable: true
            }
         };
         const rawInput = getRawOptions(expectedOptions);

         expect(filterComponentOptions(rawInput)).to.deep.equal(expectedOptions);
      });
      it('should keep options with types', () => {
         const expectedOptions = {
            withItemType: {
               itemType: 'Module/lib:File'
            },
            withArrayElementType: {
               arrayElementType: 'Module/File.typedef'
            }
         };
         const rawInput = getRawOptions(expectedOptions);

         expect(filterComponentOptions(rawInput)).to.deep.equal(expectedOptions);
      });
   });
   describe('filterComponentProperties', () => {
      it('should return empty object', () => {
         const rawInput = getRawComponentOptions({
            'First/module': {},
            'Second/module.typedef': {},
         });

         expect(filterComponentProperties(rawInput)).to.be.empty;
      });
      it('should keep component with translatable option', () => {
         const expectedCollection = {
            'FirstTranslatable/module': toComponentData({
               translatableOption: {
                  translatable: true
               }
            })
         };
         const rawInput = getRawComponentOptions(expectedCollection);

         expect(filterComponentProperties(rawInput)).to.deep.equal(expectedCollection);
      });
      it('should keep component with type options', () => {
         const expectedCollection = {
            'SecondWithType/module': toComponentData({
               withItemType: {
                  itemType: 'Module/lib:File'
               }
            }),
            'ThirdWithType/module': toComponentData({
               withArrayElementType: {
                  arrayElementType: 'Module/File.typedef'
               }
            })
         };
         const rawInput = getRawComponentOptions(expectedCollection);

         expect(filterComponentProperties(rawInput)).to.deep.equal(expectedCollection);
      });
   });
});

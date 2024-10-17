'use strict';

const TYPE_FLAGS = ['itemType', 'arrayElementType', 'type'];
const TRANSLATION_FLAGS = ['translatable'];
const ALL_FLAGS = [...TYPE_FLAGS, ...TRANSLATION_FLAGS];
const TYPE_VALUE_SEP = '|';
const XHTML_VALUE_TYPES = /(array|content)/i;

function isTypeDefinition(typeName) {
   return typeName.endsWith('.typedef');
}

function isNotPrimitiveType(typeName) {
   return (
      typeName.includes('/') ||
      typeName.includes(':') ||
      XHTML_VALUE_TYPES.test(typeName) ||
      isTypeDefinition(typeName)
   );
}

function filterTypeValue(typeValue) {
   return typeValue.split(TYPE_VALUE_SEP).filter(isNotPrimitiveType).join(TYPE_VALUE_SEP);
}

function getComponentOptions(component) {
   return (
      component &&
      component.properties &&
      component.properties['ws-config'] &&
      component.properties['ws-config'].options
   );
}

function toComponentOptions(options) {
   return {
      properties: {
         'ws-config': {
            options
         }
      }
   };
}

function filterComponentOptions(componentOptions) {
   const filteredOptions = { };
   let hasTranslatableOptions = false;

   for (const optionName in componentOptions) {
      if (componentOptions.hasOwnProperty(optionName)) {
         const optionValue = componentOptions[optionName];
         const filteredValue = { };
         let isOptionTranslatable = false;

         for (const flagName of ALL_FLAGS) {
            if (!optionValue.hasOwnProperty(flagName)) {
               continue;
            }

            let flagValue = optionValue[flagName];

            if (TYPE_FLAGS.includes(flagName)) {
               flagValue = filterTypeValue(flagValue);
               if (!flagValue) {
                  continue;
               }
            }

            filteredValue[flagName] = flagValue;
            isOptionTranslatable = true;
         }

         if (isOptionTranslatable) {
            filteredOptions[optionName] = filteredValue;
            hasTranslatableOptions = true;
         }
      }
   }

   return hasTranslatableOptions ? filteredOptions : undefined;
}

function filterComponentProperties(componentProperties) {
   const result = { };

   for (const componentName in componentProperties) {
      if (componentProperties.hasOwnProperty(componentName)) {
         const componentOptions = getComponentOptions(componentProperties[componentName]);
         if (!componentOptions) {
            continue;
         }

         const filteredOptions = filterComponentOptions(componentOptions);
         if (!filteredOptions) {
            continue;
         }

         result[componentName] = toComponentOptions(filteredOptions);
      }
   }

   return result;
}

module.exports = filterComponentProperties;

module.exports.filterTypeValue = filterTypeValue;
module.exports.filterComponentOptions = filterComponentOptions;
module.exports.filterComponentProperties = filterComponentProperties;

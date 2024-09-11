/* eslint-disable */
define('TestModuleWithoutModuleJs/MyComponent', ['CompoundControl'], function(CompoundControl) {
   'use strict';

   /**
    * Класс контрола "Кнопка "Назад".
    * @class TestModuleWithoutModuleJs/MyComponent
    * @extends Lib/Control/CompoundControl/CompoundControl
    */
   var Component = CompoundControl.extend(
      /** @lends TestModuleWithoutModuleJs/MyComponent.prototype */ {
         $protected: {
            _options: {
               /**
                * @cfg {String} Устанавливает надпись на кнопке.
                * @translatable
                */
               caption: '',

               /**
                * @cfg {String} Устанавливает изображение иконки на кнопке.
                */
               icon: ''
            }
         }
      }
   );
   return Component;
});

/* eslint-disable */
define('js!My.Component', ['CompoundControl'], function(CompoundControl) {
   'use strict';

   /**
    * Класс контрола "Кнопка "Назад".
    * @class My.Component
    * @extends Lib/Control/CompoundControl/CompoundControl
    */
   var Component = CompoundControl.extend(
      /** @lends My.Component.prototype */ {
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

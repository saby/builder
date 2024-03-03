define('Modul/ComponentWithOption', ['Core/Control'], function(Control) {
   /**
    * @class Modul/ComponentWithOption
    * @extends Core/Control
    * @control
    */
   var ComponentWithOption = Control.extend(
      /** @lends Modul/ComponentWithOption.prototype */ {
         $protected: {
            _options: {

               /**
                * @cfg {String}
                * @translatable
                */
               caption: ''
            }
         }
      }
   );
   return ComponentWithOption;
});

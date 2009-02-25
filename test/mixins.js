OXTest.Mixins = new YAHOO.tool.TestCase({
  name: 'OX Mixin Tests',

  testInDialog: function () {
    var Assert = YAHOO.util.Assert;

    Assert.isObject(OX.Mixins.InDialog, 'InDialog mixin is not available.');
    Assert.isFunction(OX.Mixins.InDialog.transfer,
                      'InDialog.transfer is not a function.');
  },

  testPreDialog: function () {
    var Assert = YAHOO.util.Assert;

    Assert.isObject(OX.Mixins.PreDialog, 'PreDialog mixin is not available.');
    Assert.isFunction(OX.Mixins.PreDialog.hangup,
                      'PreDialog.hangup is not a function.');
  },

  testCallLabeler: function () {
    var Assert = YAHOO.util.Assert;

    Assert.isObject(OX.Mixins.CallLabeler,
                    'CallLabeler mixin is not available.');
    Assert.isFunction(OX.Mixins.CallLabeler.label,
                      'CallLabeler.label is not a function.');
  },

  testSubscribable: function () {
    var Assert = YAHOO.util.Assert;

    Assert.isObject(OX.Mixins.Subscribable,
                    'Subscribable mixin is not available.');
    Assert.isFunction(OX.Mixins.Subscribable.subscribe,
                      'Subscribable.subscribe is not a function.');
    Assert.isFunction(OX.Mixins.Subscribable.unsubscribe,
                      'Subscribable.unsubscribe is not a function.');
    Assert.isFunction(OX.Mixins.Subscribable.getItems,
                      'Subscribable.getItems is not a function.');
  }
});

YAHOO.tool.TestRunner.add(OXTest.Mixins);
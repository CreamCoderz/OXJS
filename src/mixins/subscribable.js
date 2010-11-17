/**
 * @namespace
 * Subscribable mixin.
 *
 * @requires connection A property which is an {@link OX.ConnectionAdapter} object on receiving object.
 * @requires pubSubURI The URI of the PubSub service.
 * @requires itemFromPacket A function which takes a packet argument and returns an item.
 */
OX.Mixin.Subscribable = (function () {
  /**#nocode+*/
  function packetType(element) {
    switch (element.tagName) {
    case 'subscription':
      return element.getAttribute('subscription');
    case 'items':
      if (element.firstChild.tagName === 'retract') {
        return 'retract';
      }
      return 'publish';
    default:
      return undefined;
    }
  }

  function convertItems(document) {
    function itemURI(itemID, node) {
      var from  = document.getAttribute('from'),
          items = document.firstChild.firstChild;

      return OX.URI.fromObject({path: from,
                                query: ';node=' + node + ';item=' + itemID});
    }
    function getPublishTime(element) {
      var firstChild  = element.firstChild,
          publishTime = firstChild && firstChild.getAttribute('publish-time');

      return publishTime;
    }

    /*
     * TODO: Without XPath we're taking some schema risks
     * here. Really we only want `/iq/pubsub/items/item'
     * nodes. Since we can't do that easily, just grab any `items'
     * elements and pass any immediate descendants named `item' to
     * itemFromElement.
     */
    var rc    = [],
        items = document.getElementsByTagName('items') || [];

    // Grab the first `items' node found.
    for (var i = 0, len = items.length; i < len; i++) {
      if (items[i] && items[i].childNodes) {
        var children = items[i].childNodes,
            node     = items[i].getAttribute('node') || '/',
            item;

        for (var ii = 0, ilen = children.length; ii < ilen; ii++) {
          if (children[ii].tagName && children[ii].tagName === 'item') {
            item = this.itemFromElement(children[ii]);

            item.publishTime = getPublishTime(children[ii]);
            item.uri = itemURI(children[ii].getAttribute('id'),
                               node);
            rc.push(item);
          }
        }
      }
    }

    return rc;
  }

  function fireEvent(type, packet) {
    function subscriptionURI() {
      var elt    = packet.getNode(),
          from   = elt.getAttribute('from'),
          sub    = elt.firstChild.firstChild,
          node   = sub.getAttribute('node') || '/';

      return OX.URI.fromObject({path:   from, query: ';node=' + node});
    }

    function retractURI() {
      var elt    = packet.getNode(),
          from   = elt.getAttribute('from'),
          items  = elt.getElementsByTagName('items')[0],
          node   = items.getAttribute('node') || '/',
          itemID = items.firstChild.getAttribute('id');

      return OX.URI.fromObject({path:  from,
                                query: ';node=' + node + ';item=' + itemID});
    }

    switch (type) {
    case 'subscribed':
      if (this._subscriptionHandlers.onSubscribed) {
        var subscribedURI = subscriptionURI();
        this._subscriptionHandlers.onSubscribed(subscribedURI);
      }
      break;
    case 'pending':
      if (this._subscriptionHandlers.onPending) {
        var pendingURI = subscriptionURI();
        this._subscriptionHandlers.onPending(pendingURI);
      }
      break;
    case 'none':
      if (this._subscriptionHandlers.onUnsubscribed) {
        var unsubscribedURI = subscriptionURI();
        this._subscriptionHandlers.onUnsubscribed(unsubscribedURI);
      }
      break;
    case 'publish':
      if (this._subscriptionHandlers.onPublish) {
        var items = convertItems.call(this, packet.getNode());
        for (var i = 0, len = items.length; i < len; i++) {
          this._subscriptionHandlers.onPublish(items[i]);
        }
      }
      break;
    case 'retract':
      if (this._subscriptionHandlers.onRetract) {
        this._subscriptionHandlers.onRetract(retractURI());
      }
      break;
    }
  }

  function jidHandler(packet) {
    var event = packet.getNode().getElementsByTagName('event')[0];
    if (!event) {
      return;
    }

    fireEvent.call(this, packetType(event.firstChild), packet);
  }

  function getSubscriptionsHandler(packet, node, callbacks, origNode,
                                   redirectCount, strict) {
    callbacks     = callbacks     || {};
    redirectCount = redirectCount || 0;
    origNode      = origNode      || node;

    if (!packet) {
      return;
    }

    var finalURI = this.pubSubURI,
        reqURI   = this.pubSubURI;

    if (node) {
      finalURI = finalURI.extend({query: ';node=' + node});
    }

    if (origNode) {
      reqURI   = reqURI.extend({query: ';node=' + origNode});
    }

    if (packet.getType() === 'error' && callbacks.onError) {
      // TODO: handle getSubscriptions redirects
      callbacks.onError(reqURI, finalURI, packet);
    } else if (packet.getType() === 'result' && callbacks.onSuccess) {
      var subscriptions = [],
          subElements = packet.getNode().getElementsByTagName('subscription');
      for (var i = 0; i < subElements.length; i++) {
        if (strict && this.connection.getJID() !== subElements[i].getAttribute('jid')) {
          continue;
        }

        subscriptions.push({
          node: subElements[i].getAttribute('node') || '/',
          jid: subElements[i].getAttribute('jid'),
          subscription: subElements[i].getAttribute('subscription'),
          subid: subElements[i].getAttribute('subid')
        });
      }

      callbacks.onSuccess(reqURI, finalURI, subscriptions, packet);
    }
  }

  function configureNodeHandler(packet, subscription, options, callbacks) {
    if (!packet) {
      return;
    }

    if (packet.getType() === 'error') {
      // TODO: handle redirects
      if (callbacks.onError) {
        callbacks.onError(packet);
      }
    } else if (packet.getType() === 'result' && callbacks.onSuccess) {
      callbacks.onSuccess(packet);
    }
  }

  function subscriptionHandler(packet, node, options, callbacks,
                               origNode, redirects) {
    callbacks = callbacks || {};
    redirects = redirects || 0;

    if (!packet) {
      return;
    }

    var finalURI = this.pubSubURI.extend({query: ';node=' + node}),
        reqURI   = this.pubSubURI.extend({query: ';node=' + (origNode || node)});
    if (packet.getType() === 'error') {
      var error = packet.getNode().getElementsByTagName('error')[0];
      if (redirects < 5 && error && error.firstChild &&
          (error.firstChild.tagName === 'redirect' ||
           error.firstChild.tagName === 'gone')) {
        var uri;
        if (window.ActiveXObject) {
          // Browser is IE
          uri = OX.URI.parse(error.firstChild.text);
        } else {
          uri = OX.URI.parse(error.firstChild.textContent);
        }
        var path    = uri.path,
            newNode = uri.queryParam('node');
        if (path && newNode) {
          doSubscribe.call(this, newNode, options, callbacks,
                           origNode, redirects + 1);
        }
      } else if (callbacks.onError) {
        callbacks.onError(reqURI, finalURI, packet);
      }
    } else {
      if (callbacks.onSuccess) {
        callbacks.onSuccess(reqURI, finalURI, packet);
      }

      var pubSub = packet.getNode().getElementsByTagName('pubsub')[0] || {},
          subscription = pubSub.firstChild;
      if (subscription && subscription.tagName === 'subscription') {
        fireEvent.call(this, packetType(subscription), packet);
      }
    }
  }

  function unsubscriptionHandler(packet, node, callbacks) {
    var uri = this.pubSubURI.extend({query: ';node=' + node});
    callbacks = callbacks || {};

    if (!packet) {
      return;
    }

    if (packet.getType() === 'error') {
      if (callbacks.onError) {
        callbacks.onError(uri, packet.getNode());
      }
    } else {
      if (callbacks.onSuccess) {
        callbacks.onSuccess(uri, packet.getNode());
      }
    }
  }

  function getItemsHandler(packet, callbacks) {
    callbacks = callbacks || {};

    if (!packet) {
      return;
    }

    if (packet.getType() === 'error') {
      if (callbacks.onError) {
        callbacks.onError(packet);
      }
    } else {
      if (callbacks.onSuccess) {
        callbacks.onSuccess(convertItems.call(this, packet.getNode()));
      }
    }
  }

  function zeroPad(spaces, value) {
    var rc = (value || '').toString();
    for (var i = spaces - rc.length; i > 0; i--) {
      rc = '0' + rc;
    }
    return rc;
  }

  var optionTransforms = {
    expire: function (direction, value) {
      switch (direction) {
      case 'fromString':
        return 'oops';
      case 'toString':
        var d  = zeroPad(2, value.getUTCDate()),
            m  = zeroPad(2, value.getUTCMonth() + 1),
            y  = zeroPad(4, value.getUTCFullYear()),
            hh = zeroPad(2, value.getUTCHours()),
            mm = zeroPad(2, value.getUTCMinutes()),
            ss = zeroPad(2, value.getUTCSeconds()),
            ms = zeroPad(4, value.getUTCMilliseconds());
        return y + '-' + m + '-' + d + 'T' + hh + ':' + mm + ':' + ss + '.' + ms + '000Z';
      default:
        return undefined;
      }
    }
  };

  function objectToOptionsForm(options) {
    var xData = OX.XML.XMPP.XDataForm.create({type: 'submit'}),
        opts  = OX.XML.Element.extend({name: 'options'}).create({}, xData);

    xData.addField('FORM_TYPE', 'http://jabber.org/protocol/pubsub#subscribe_options');

    for (var o in options) {
      if (options.hasOwnProperty(o)) {
        var trVal = options[o];
        if (optionTransforms[o]) {
          trVal = optionTransforms[o]('toString', trVal);
        }
        xData.addField('pubsub#' + o, trVal);
      }
    }

    return opts;
  }

  function doConfigureNode(subscription, options, callbacks) {
    var iq = OX.XML.XMPP.IQ.extend(),
        pubsub = OX.XML.XMPP.PubSub.extend();

    iq.to(this.pubSubURI.path);
    iq.type('set');
    iq.addChild(pubsub);

    options = options || {};

    var opts = objectToOptionsForm.call(this, options);
    opts.attr('node', subscription.node);
    opts.attr('jid', subscription.jid);
    opts.attr('subid', subscription.subid);

    pubsub.addChild(opts);

    var that = this;
    var wrappedCb = function () {
          configureNodeHandler.apply(that, arguments);
        },
        wrappedArgs = [subscription, options, callbacks];

    this.connection.send(iq.toString(), wrappedCb, wrappedArgs);
  }

  function doSubscribe(node, options, callbacks, origNode, redirectCount) {
    var iq        = OX.XML.XMPP.IQ.extend(),
        pubsub    = OX.XML.Element.extend({name:  'pubsub',
                                       xmlns: 'http://jabber.org/protocol/pubsub'}),
        subscribe = OX.XML.Element.extend({name: 'subscribe'});

    iq.to(this.pubSubURI.path);
    iq.type('set');
    subscribe.attr('node', node);
    subscribe.attr('jid', this.connection.getJID());
    pubsub.addChild(subscribe);
    if (options) {
      var opts = objectToOptionsForm.call(this, options);
      pubsub.addChild(opts);
    }
    iq.addChild(pubsub);

    var that = this;
    var cb = function () {
      subscriptionHandler.apply(that, arguments);
    };

    this.connection.send(iq.toString(), cb,
                         [node, options, callbacks, origNode, redirectCount]);
  }

  function doGetSubcriptions(node, callbacks, origNode, redirectCount, strict) {
    var iq = OX.XML.XMPP.IQ.extend(),
        pub = OX.XML.XMPP.PubSub.extend(),
        sub = OX.XML.Element.extend({name: 'subscriptions'});

    iq.to(this.pubSubURI.path);
    iq.type('get');

    if (node) {
      sub.attr('node', node);
    }

    pub.addChild(sub);
    iq.addChild(pub);

    var that = this;
    var wrappedCb = function () {
          getSubscriptionsHandler.apply(that, arguments);
        },
        wrappedArgs = [node, callbacks, origNode, redirectCount, strict];

    this.connection.send(iq.toString(), wrappedCb, wrappedArgs);
  }
  /**#nocode-*/

  /**
   * @name OX.Subscription
   * @class Subscription object signature.
   * @see <a href="http://xmpp.org/extensions/xep-0060.html#schemas-pubsub">XMPP PubSub schema</a>
   */

  /**
   * @name OX.Subscription#node
   * @field
   * @description
   * The optional node that the subscription is on.
   * @type {String}
   */

  /**
   * @name OX.Subscription#jid
   * @field
   * @description
   * The required JID that the subscription is on.
   * @type {String}
   */

  /**
   * @name OX.Subscription#subscription
   * @field
   * @description
   * The optional subscription state of the subscription.
   * One of 'none', 'pending', 'subscribed', or 'unconfigured'.
   * @type {String}
   */

  /**
   * @name OX.Subscription#subid
   * @field
   * @description
   * The optional subscription id.
   * @type {String}
   */

  return /** @lends OX.Mixin.Subscribable# */{

    /**
     * @private
     * Registers appropriate handlers with the connection for pubSubJID.
     */
    init: function ($super) {
      var tpl = OX.Mixin.Subscribable._subscriptionHandlers;
      this._subscriptionHandlers = OX.Base.extend(tpl);

      if (this.connection && this.pubSubURI) {
        var uri = this.pubSubURI;
        var that = this;
        var handler = function () {
          jidHandler.apply(that, arguments);
        };
        this.connection.registerJIDHandler(uri.path, handler);
      }

      $super();
    }.around(),

    /**
     * Get subscriptions on a node.
     *
     * Passing an initial <tt>node</tt> parameter retrieves subscriptions on the requested
     * node.  Otherwise a single parameter of <tt>callbacks</tt> requests all subscriptions
     * at all nodes of the pubsub service.
     *
     * @see <a href="http://xmpp.org/extensions/xep-0060.html#entity-subscriptions">XEP: 0060 - Entity Subscriptions</a>
     *
     * @param {String} [node] The node name to request subscriptions on. Omitting the node name implies all nodes
     * @param {Object} callbacks an object supplying functions for 'onSuccess' and 'onError'
     *   @param {Function} callbacks.onSuccess The success callback.
     *     @param {OX.URI} callbacks.onSuccess.requestedURI The URI you requested.
     *     @param {OX.URI} callbacks.onSuccess.finalURI The redirected URI that your requested URI maps to.
     *     @param {OX.Subscription[]} callbacks.onSuccess.subscriptions The subscriptions associated with the finalURI.
     *     @param {OX.PacketAdapter} callbacks.onSuccess.packet The packet recieved.
     *   @param {Function} callbacks.onError The error callback.
     *     @param {OX.URI} callbacks.onError.requestedURI The URI you requested.
     *     @param {OX.URI} callbacks.onError.finalURI The redirected URI that your requested URI maps to.
     *     @param {OX.PacketAdapter} callbacks.onError.packet The packet recieved.
     * @param {Boolean} [strictJIDMatch] Only apply callbacks to subscriptions that match the exact JID as the current connection.
     * This will NOT match a bare JID to a full JID.
     *
     * @example
     *   service.getSubscriptions('/', {
     *     onSuccess: function (requestedURI, finalURI, subscriptions, packet) {},
     *     onError: function (requestedURI, finalURI, packet)
     *   });
     *
     * @example
     *   service.getSubscriptions({
     *     onSuccess: function (requestedURI, finalURI, subscriptions, packet) {},
     *     onError: function (requestedURI, finalURI, packet)
     *   });
     */
    getSubscriptions: function (node, callbacks, strictJIDMatch) {
      if (arguments.length === 1) {
        callbacks = arguments[0];
        node = undefined;
        strictJIDMatch = undefined;
      } else if (arguments.length === 2 &&
                 (arguments[0].hasOwnProperty('onSucess') || arguments[0].hasOwnProperty('onError'))) {
        callbacks = arguments[0];
        strictJIDMatch = arguments[1];
        node = undefined;
      }

      doGetSubcriptions.call(this, node, callbacks, node, 0, strictJIDMatch);
    },

    configureNode: function (subscription, options, callbacks) {
      doConfigureNode.apply(this, arguments);
    },

    /**
     * Subscribe to a nade.
     *
     * @param {String} node The node ID to subscribe to.
     * @param {Object} [options] Subscription options.
     * @param {Object} [callbacks] an object supplying functions for 'onSuccess', and 'onError'.
     *   @param {Function} [callbacks.onSuccess] The success callback.
     *     @param {OX.URI} [callbacks.onSuccess.requestedURI] The URI you requested.
     *     @param {OX.URI} [callbacks.onSuccess.finalURI] The redirected URI that your requested URI maps to.
     *   @param {Function} [callbacks.onError] The error callback.
     *     @param {OX.URI} [callbacks.onError.requestedURI] The URI you requested.
     *     @param {OX.URI} [callbacks.onError.finalURI] The redirected URI that your requested URI maps to.
     * 
     * @example
     *   service.subscribe('/', {
     *     onSuccess: function (requestedURI, finalURI) {},
     *     onError:   function (requestedURI, finalURI) {}
     *   });
     *
     *   var options = {expires: new Date()};
     *   service.subscribe('/', options, {
     *     onSuccess: function (requestedURI, finalURI) {},
     *     onError:   function (requestedURI, finalURI) {}
     *   });
     */
    subscribe: function (node, options, callbacks) {
      if (arguments.length === 2) {
        callbacks = options;
        options   = undefined;
      }

      doSubscribe.call(this, node, options, callbacks, node, 0);
    },

    /**
     * Unsubscribe from a node.
     *
     * @param {String} node The node ID to subscribe to
     * @param {Object} [callbacks] an object supplying functions for 'onSuccess', and 'onError'.
     *   @param {Function} [callbacks.onSuccess] The success callback.
     *     @param {OX.URI} [callbacks.onSuccess.uri] The URI you unsubscribed from.
     *   @param {Function} [callbacks.onError] The error callback.
     *     @param {OX.URI} [callbacks.onSuccess.uri] The URI you failed to unsubscribe from.
     *
     * @example
     *   service.unsubscribe('/', {
     *     onSuccess: function (uri) {},
     *     onError:   function (uri) {}
     *   });
     */
    unsubscribe: function (node, callbacks) {
      var iq          = OX.XML.XMPP.IQ.extend(),
          pubsub      = OX.XML.Element.extend({name:  'pubsub',
                                               xmlns: 'http://jabber.org/protocol/pubsub'}),
          unsubscribe = OX.XML.Element.extend({name: 'unsubscribe'});

      iq.to(this.pubSubURI.path);
      iq.type('set');
      unsubscribe.attr('node', node);
      unsubscribe.attr('jid',  this.connection.getJID());
      iq.addChild(pubsub.addChild(unsubscribe));

      var that = this;
      var cb = function () {
        unsubscriptionHandler.apply(that, arguments);
      };
      this.connection.send(iq.toString(), cb, [node, callbacks]);
    },

    /**
     * Get the items on a PubSub node.
     *
     * @param {String} node The node ID to subscribe to
     * @param {Object} [callbacks] an object supplying functions for 'onSuccess', and 'onError'
     *   @param {Function} [callbacks.onSuccess] The success callback.
     *     @param {OX.Item[]} [callbacks.onSuccess.items] The items on the PubSub node.
     *   @param {Function} [callbacks.onError] The error callback.
     *     @param {OX.PacketAdapter} [callbacks.onSuccess.packet] The recieved packet.
     *
     * @example
     *   service.getItems('/', {
     *     onSuccess: function (items) {},
     *     onError:   function (errorPacket) {}
     *   });
     */
    getItems: function (node, callbacks) {
      var iq     = OX.XML.XMPP.IQ.extend(),
          pubsub = OX.XML.Element.extend({name:  'pubsub',
                                          xmlns: 'http://jabber.org/protocol/pubsub'}),
          items  = OX.XML.Element.extend({name: 'items'});

      iq.to(this.pubSubURI.path);
      iq.type('get');
      items.attr('node', node);
      iq.addChild(pubsub.addChild(items));

      var that = this;
      var cb = function () {
        getItemsHandler.apply(that, arguments);
      };
      this.connection.send(iq.toString(), cb, [callbacks]);
    },

    /**
     * Registers a handler for an event.
     *
     * Only one handler can be registered for a given event at a time.
     *
     * @param {String} event One of the strings 'onPending', 'onSubscribed', 'onUnsubscribed', 'onPublish' or 'onRetract'.
     * @param {Function} handler A function which accepts one argument, which is the packet response.
     *
     * @example
     *   service.registerHandler('onPublish', function (item) {});
     */
    registerHandler: function (event, handler) {
      this._subscriptionHandlers[event] = handler;
    },

    /**
     * Unregisters an event handler.
     *
     * @param {String} event One of the strings 'onPending', 'onSubscribed', 'onUnsubscribed', 'onPublish' or 'onRetract'.
     *
     * @example
     *   service.unregisterHandler('onPublish', handlerFunction);
     */
    unregisterHandler: function (event) {
    },

    /**
     * Turn a packet into an item for this service. By default, this
     * does nothing. You must override this within the object being
     * extended for useful behavior.
     */
    itemFromPacket: function (packet) {},

    /**
     * @private
     * Handlers for various subscription related events.
     */
    _subscriptionHandlers: {
      /**
       * @private
       * This handler is called when we get a pending subscription
       * notification.
       *
       * @param {OX.URI.Base} uri The URI of the subscription request, after redirects.
       */
      onPending: function (uri) {},

      /**
       * @private
       * This handler is called when we get a completed subscription.
       *
       * @param {OX.URI.Base} uri The URI of the subscription request, after redirects.
       */
      onSubscribed: function (uri) {},

      /**
       * @private
       * This handler is called when we our subscription is removed.
       *
       * @param {OX.URI.Base} uri The node we were unsubscribed from.
       */
      onUnsubscribed: function (uri) {},

      /**
       * @private
       * This handler is called when an item is published.
       *
       * @param {OX.Item} item The published item.
       */
      onPublish: function (item) {},

      /**
       * @private
       * This handler is called when an item is retracted.
       *
       * @param {OX.URI.Base} uri The URI of the retracted item.
       */
      onRetract: function (uri) {}
    }
  };
}());
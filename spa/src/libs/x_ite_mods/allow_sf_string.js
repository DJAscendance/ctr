(function () {
    // Add SFxxx types to the Window Object, a hacky way of allowing var x = SFString("asdf") in scripts.
    // X_ITE 15 exports the field classes straight off the global X3D object, so take them
    // from there when present. X_ITE 4.x only exposes them through the AMD loader, so fall
    // back to X3D.require for anything the global object is missing.
    var names = ["SFBool", "SFString", "SFInt32"];
    var missing = [];

    names.forEach(function (name) {
        if (X3D[name]) {
            window[name] = X3D[name];
        } else {
            missing.push(name);
        }
    });

    if (!missing.length) return;

    X3D.require(
        missing.map(function (name) { return "x_ite/Fields/" + name; }),
        function () {
            for (var i = 0; i < missing.length; i++) {
                window[missing[i]] = arguments[i];
            }
        }
    );
})();

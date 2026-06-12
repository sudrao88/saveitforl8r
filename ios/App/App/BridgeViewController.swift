import Capacitor

/// Storyboard view controller that registers custom (non-SPM-packaged)
/// Capacitor plugins. Main.storyboard points at this class instead of the
/// stock CAPBridgeViewController.
class BridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(TextEmbedderPlugin())
    }
}

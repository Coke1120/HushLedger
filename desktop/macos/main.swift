import AppKit
import Darwin
import WebKit

final class EventReader: @unchecked Sendable {
  private var pending = Data()
  private let lock = NSLock()

  func consume(_ data: Data) -> [[String: String]] {
    lock.lock()
    defer { lock.unlock() }
    pending.append(data)
    var events = [[String: String]]()
    while let end = pending.firstIndex(of: 10) {
      let line = pending.prefix(upTo: end)
      pending.removeSubrange(...end)
      if let event = try? JSONSerialization.jsonObject(with: line) as? [String: String] {
        events.append(event)
      }
    }
    return events
  }
}

@MainActor
final class LedgerApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var overlay: NSView!
  private var status: NSTextField!
  private var spinner: NSProgressIndicator!
  private var logButton: NSButton!
  private var backend: Process?
  private var input: Pipe?
  private var output: Pipe?
  private var errorLog: FileHandle?
  private var terminating = false
  private var ready = false
  private var failed = false
  private var messages = [String: String]()
  private var smokeTest = false
  private var smokeTestHold = false
  private var origin = URL(string: "http://127.0.0.1:8787/")!
  private var support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("HushLedger", isDirectory: true)

  private func text(_ key: String) -> String { messages[key] ?? key }

  func applicationDidFinishLaunching(_ notification: Notification) {
    do {
      try configureSmokeTest()
      let resources = Bundle.main.resourceURL!
      let dictionaries = try JSONDecoder().decode([String: [String: String]].self,
        from: Data(contentsOf: resources.appendingPathComponent("messages.json")))
      let language = Locale.preferredLanguages.first ?? "en"
      let locale = language.hasPrefix("zh") ? "zh-Hant"
        : language.hasPrefix("ja") ? "ja" : language.hasPrefix("fr") ? "fr" : "en"
      messages = dictionaries[locale] ?? dictionaries["en"] ?? [:]
      makeWindow()
      makeMenus()
      try startBackend(resources)
    } catch {
      if window == nil { makeWindow() }
      showFailure("START_FAILED")
    }
    NSApp.activate(ignoringOtherApps: true)
  }

  private func makeWindow() {
    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1160, height: 780),
      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = smokeTestHold ? "HushLedger · Synthetic preview" : "HushLedger"
    window.minSize = NSSize(width: 860, height: 620)
    window.isReleasedWhenClosed = false
    window.isRestorable = false
    window.delegate = self
    window.center()
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = smokeTest ? .nonPersistent() : .default()
    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.translatesAutoresizingMaskIntoConstraints = false
    overlay = NSView()
    overlay.wantsLayer = true
    overlay.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    overlay.translatesAutoresizingMaskIntoConstraints = false
    status = NSTextField(wrappingLabelWithString: text("desktopStarting"))
    status.font = .systemFont(ofSize: 16)
    status.alignment = .center
    spinner = NSProgressIndicator()
    spinner.style = .spinning
    spinner.startAnimation(nil)
    logButton = NSButton(title: text("desktopOpenLog"), target: self, action: #selector(openLog))
    logButton.isHidden = true
    let stack = NSStackView(views: [spinner, status, logButton])
    stack.orientation = .vertical
    stack.spacing = 16
    stack.translatesAutoresizingMaskIntoConstraints = false
    let content = window.contentView!
    content.addSubview(webView)
    content.addSubview(overlay)
    overlay.addSubview(stack)
    for view in [webView!, overlay!] {
      NSLayoutConstraint.activate([
        view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
        view.trailingAnchor.constraint(equalTo: content.trailingAnchor),
        view.topAnchor.constraint(equalTo: content.topAnchor),
        view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
      ])
    }
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
      stack.widthAnchor.constraint(lessThanOrEqualToConstant: 460),
    ])
    window.makeKeyAndOrderFront(nil)
  }

  private func makeMenus() {
    let bar = NSMenu()
    let app = NSMenuItem()
    app.submenu = NSMenu()
    app.submenu?.addItem(withTitle: text("desktopQuit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    bar.addItem(app)
    let edit = NSMenuItem(title: text("edit"), action: nil, keyEquivalent: "")
    edit.submenu = NSMenu(title: text("edit"))
    for (key, selector, shortcut) in [
      ("desktopUndo", "undo:", "z"), ("desktopCut", "cut:", "x"),
      ("desktopCopy", "copy:", "c"), ("desktopPaste", "paste:", "v"),
      ("desktopSelectAll", "selectAll:", "a"),
    ] {
      edit.submenu?.addItem(withTitle: text(key), action: NSSelectorFromString(selector), keyEquivalent: shortcut)
    }
    bar.addItem(edit)
    let view = NSMenuItem(title: text("desktopView"), action: nil, keyEquivalent: "")
    view.submenu = NSMenu(title: text("desktopView"))
    let reload = NSMenuItem(title: text("refresh"), action: #selector(reloadPage), keyEquivalent: "r")
    reload.target = self
    view.submenu?.addItem(reload)
    view.submenu?.addItem(withTitle: text("close"), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    bar.addItem(view)
    NSApp.mainMenu = bar
  }

  private func startBackend(_ resources: URL) throws {
    let desktop = support.appendingPathComponent("desktop", isDirectory: true)
    for directory in [support, desktop] {
      if FileManager.default.fileExists(atPath: directory.path) {
        let attributes = try FileManager.default.attributesOfItem(atPath: directory.path)
        guard attributes[.type] as? FileAttributeType == .typeDirectory else {
          throw CocoaError(.fileWriteInvalidFileName)
        }
      } else {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: false,
          attributes: [.posixPermissions: 0o700])
      }
    }
    if smokeTest {
      try Data(String(getpid()).utf8).write(to: support.appendingPathComponent("smoke.pid"), options: .atomic)
    }
    let logURL = desktop.appendingPathComponent("launcher.log")
    let descriptor = Darwin.open(logURL.path, O_CREAT | O_WRONLY | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { throw CocoaError(.fileWriteNoPermission) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_nlink == 1 else {
      Darwin.close(descriptor)
      throw CocoaError(.fileWriteNoPermission)
    }
    errorLog = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
    fchmod(descriptor, 0o600)
    try errorLog?.truncate(atOffset: 0)
    let process = Process()
    process.executableURL = resources.appendingPathComponent("bin/node")
    process.arguments = [resources.appendingPathComponent("server.mjs").path,
      "--resources", resources.path, "--support", support.path, "--parent-pid", String(getpid()),
      "--port", String(origin.port!)]
    process.currentDirectoryURL = desktop
    let stdin = Pipe()
    let stdout = Pipe()
    input = stdin
    output = stdout
    process.standardInput = stdin
    process.standardOutput = stdout
    process.standardError = errorLog
    let reader = EventReader()
    stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      if data.isEmpty { handle.readabilityHandler = nil; return }
      let events = reader.consume(data)
      Task { @MainActor in
        for event in events { self?.receive(event) }
      }
    }
    process.terminationHandler = { [weak self] _ in
      Task { @MainActor in self?.backendExited() }
    }
    backend = process
    try process.run()
    // Only the parent keeps this end open: EOF lets the supervisor detect a crash.
    try? stdin.fileHandleForReading.close()
  }

  private func receive(_ event: [String: String]) {
    switch event["event"] {
    case "ready":
      guard !terminating, event["url"] == origin.absoluteString else { return }
      ready = true
      webView.load(URLRequest(url: origin))
    case "error": showFailure(event["code"] ?? "START_FAILED")
    default: break
    }
  }

  private func showFailure(_ code: String) {
    failed = true
    ready = false
    spinner?.stopAnimation(nil)
    let key = code == "PORT_IN_USE" ? "desktopPortInUse"
      : code == "LEDGER_BUSY" ? "desktopDatabaseBusy" : "desktopStartFailed"
    status?.stringValue = text(key)
    overlay?.isHidden = false
    logButton?.isHidden = false
    if smokeTest { finishSmokeTest(false) }
  }

  // Only the archive smoke check uses this explicit, temporary, nonpersistent
  // mode. Ordinary launches retain the existing support path and WebKit store.
  private func configureSmokeTest() throws {
    let arguments = CommandLine.arguments
    guard let index = arguments.firstIndex(of: "--smoke-test-support") else { return }
    guard index + 1 < arguments.count,
      let portIndex = arguments.firstIndex(of: "--smoke-test-port"), portIndex + 1 < arguments.count,
      let port = Int(arguments[portIndex + 1]), (1024...65535).contains(port) else {
      throw CocoaError(.fileReadInvalidFileName)
    }
    let requested = URL(fileURLWithPath: arguments[index + 1], isDirectory: true).standardizedFileURL
    let parent = requested.deletingLastPathComponent().resolvingSymlinksInPath()
    let temporary = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true).resolvingSymlinksInPath()
    guard parent.path.hasPrefix(temporary.path + "/"),
      !FileManager.default.fileExists(atPath: requested.path) else {
      throw CocoaError(.fileWriteInvalidFileName)
    }
    support = parent.appendingPathComponent(requested.lastPathComponent, isDirectory: true)
    origin = URL(string: "http://127.0.0.1:\(port)/")!
    smokeTest = true
    smokeTestHold = arguments.contains("--smoke-test-hold")
  }

  private func finishSmokeTest(_ passed: Bool) {
    let result: [String: Any] = ["ok": passed, "url": origin.absoluteString]
    if let data = try? JSONSerialization.data(withJSONObject: result) {
      try? data.write(to: support.appendingPathComponent("smoke-result.json"), options: .atomic)
    }
    NSApp.terminate(nil)
  }

  private func backendExited() {
    try? input?.fileHandleForWriting.close()
    try? errorLog?.close()
    backend = nil
    if terminating { NSApp.reply(toApplicationShouldTerminate: true) }
    else if !failed { showFailure("START_FAILED") }
  }

  func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
    guard backend?.isRunning == true else { return .terminateNow }
    if terminating { return .terminateLater }
    terminating = true
    if ready {
      webView.evaluateJavaScript("(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })()") { [weak self] result, _ in
        guard let self else { return }
        if result as? Bool == true {
          let alert = NSAlert()
          alert.messageText = self.text("discardUnsavedChangesConfirm")
          alert.addButton(withTitle: self.text("cancel"))
          alert.addButton(withTitle: self.text("desktopQuit"))
          if alert.runModal() == .alertFirstButtonReturn {
            self.terminating = false
            NSApp.reply(toApplicationShouldTerminate: false)
            return
          }
        }
        self.stopBackend()
      }
    } else { stopBackend() }
    return .terminateLater
  }

  private func stopBackend() {
    status.stringValue = text("desktopStopping")
    logButton.isHidden = true
    overlay.isHidden = false
    spinner.startAnimation(nil)
    // Leave the web view alive while its outstanding requests drain.
    try? input?.fileHandleForWriting.write(contentsOf: Data("shutdown\n".utf8))
    try? input?.fileHandleForWriting.close()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    NSApp.terminate(nil)
    return false
  }

  func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
    window.makeKeyAndOrderFront(nil)
    return true
  }

  @objc private func reloadPage() {
    if ready && !terminating { webView.load(URLRequest(url: origin)) }
  }

  @objc private func openLog() {
    NSWorkspace.shared.open(support.appendingPathComponent("desktop", isDirectory: true))
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    if !terminating { overlay.isHidden = true }
    if smokeTest && !smokeTestHold && !terminating {
      webView.evaluateJavaScript("document.title") { [weak self] result, _ in
        self?.finishSmokeTest((result as? String)?.contains("HushLedger") == true)
      }
    }
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    if (error as NSError).code != NSURLErrorCancelled && !terminating { showFailure("START_FAILED") }
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { decisionHandler(.cancel); return }
    let local = url.scheme == "http" && url.host == origin.host && url.port == origin.port
    let blob = url.absoluteString.hasPrefix("blob:" + origin.absoluteString)
    if action.shouldPerformDownload && (local || blob) { decisionHandler(.download); return }
    if local || blob { decisionHandler(.allow); return }
    if action.navigationType == .linkActivated && ["https", "http", "mailto"].contains(url.scheme ?? "") {
      NSWorkspace.shared.open(url)
    }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
    decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(response.canShowMIMEType ? .allow : .download)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
    download.delegate = self
  }

  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
    download.delegate = self
  }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
    suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = (suggestedFilename as NSString).lastPathComponent
    panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.url : nil) }
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    if (error as NSError).code == NSURLErrorCancelled { return }
    let alert = NSAlert()
    alert.messageText = text("desktopExportFailed")
    alert.beginSheetModal(for: window)
  }

  func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = parameters.allowsMultipleSelection
    panel.canChooseDirectories = parameters.allowsDirectories
    panel.canChooseFiles = true
    panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
  }

  func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.addButton(withTitle: text("desktopConfirm"))
    alert.addButton(withTitle: text("cancel"))
    alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
  }

  func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let alert = NSAlert()
    alert.messageText = message
    alert.beginSheetModal(for: window) { _ in completionHandler() }
  }
}

MainActor.assumeIsolated {
  let app = NSApplication.shared
  let delegate = LedgerApp()
  app.setActivationPolicy(.regular)
  app.delegate = delegate
  withExtendedLifetime(delegate) { app.run() }
}

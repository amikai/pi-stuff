#!/usr/bin/env swift

import Cocoa
import QuickLookUI

class FloatingPreview: NSObject, NSApplicationDelegate, QLPreviewPanelDataSource, QLPreviewPanelDelegate {
  let urls: [URL]

  init(paths: [String]) {
    self.urls = paths.compactMap { path -> URL? in
      let url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: path) else {
        return nil
      }
      return url
    }
    super.init()
  }

  override func acceptsPreviewPanelControl(_ panel: QLPreviewPanel!) -> Bool {
    return true
  }

  override func beginPreviewPanelControl(_ panel: QLPreviewPanel!) {
    panel.dataSource = self
    panel.delegate = self
  }

  override func endPreviewPanelControl(_ panel: QLPreviewPanel!) {
    panel.dataSource = nil
    panel.delegate = nil
  }

  func numberOfPreviewItems(in panel: QLPreviewPanel!) -> Int {
    return urls.count
  }

  func previewPanel(_ panel: QLPreviewPanel!, previewItemAt index: Int) -> QLPreviewItem! {
    return urls[index] as QLPreviewItem
  }

  @objc private func panelWillClose(_ notification: Notification) {
    NSApp.terminate(nil)
  }

  func previewPanel(_ panel: QLPreviewPanel!, handle event: NSEvent!) -> Bool {
    guard event.type == .keyDown else { return false }
    switch event.keyCode {
    case 49, 53:  // Space, Esc
      panel.close()
      return true
    default:
      return false
    }
  }

  func run() {
    guard !urls.isEmpty else {
      exit(1)
    }

    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.delegate = self

    guard let panel = QLPreviewPanel.shared() else {
      exit(1)
    }
    panel.level = .floating  // This makes it float above full-screen apps
    panel.hidesOnDeactivate = false
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(panelWillClose(_:)),
      name: NSWindow.willCloseNotification,
      object: panel
    )
    panel.makeKeyAndOrderFront(nil)

    // activate() from macOS 14 only takes focus when the frontmost app yields it, so the panel would open behind the terminal.
    app.activate(ignoringOtherApps: true)
    app.run()
  }
}

guard CommandLine.arguments.count > 1 else {
  print("Usage: qlf <file> [file2] ...")
  exit(1)
}

let paths = Array(CommandLine.arguments.dropFirst())
let preview = FloatingPreview(paths: paths)
preview.run()

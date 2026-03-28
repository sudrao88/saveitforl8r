import WidgetKit
import SwiftUI

// MARK: - Design Tokens

private enum WidgetColors {
    static let surfaceRaised = Color(red: 0.122, green: 0.161, blue: 0.216) // #1F2937
    static let surfaceInput  = Color(red: 0.067, green: 0.094, blue: 0.153) // #111827
    static let textPrimary   = Color(red: 0.953, green: 0.957, blue: 0.965) // #F3F4F6
    static let textSecondary = Color(red: 0.612, green: 0.639, blue: 0.686) // #9CA3AF
    static let accent        = Color(red: 0.145, green: 0.388, blue: 0.922) // #2563EB
}

private enum DeepLinks {
    static let quickNote = URL(string: "com.saveitforl8r.app://quick-note")!
    static let camera    = URL(string: "com.saveitforl8r.app://quick-note?mode=camera")!
    static let document  = URL(string: "com.saveitforl8r.app://quick-note?mode=document")!
}

// MARK: - Timeline Provider

struct QuickNoteProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickNoteEntry {
        QuickNoteEntry(date: Date())
    }

    func getSnapshot(in context: Context, completion: @escaping (QuickNoteEntry) -> Void) {
        completion(QuickNoteEntry(date: Date()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickNoteEntry>) -> Void) {
        // Static widget — no data to refresh. Set a far-future reload.
        let entry = QuickNoteEntry(date: Date())
        let timeline = Timeline(entries: [entry], policy: .never)
        completion(timeline)
    }
}

// MARK: - Timeline Entry

struct QuickNoteEntry: TimelineEntry {
    let date: Date
}

// MARK: - Widget View

struct QuickNoteWidgetView: View {
    var entry: QuickNoteProvider.Entry

    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .systemSmall:
            smallWidget
        case .systemMedium:
            mediumWidget
        case .accessoryRectangular:
            lockScreenWidget
        default:
            mediumWidget
        }
    }

    // MARK: - Small Widget (2x2)
    // Shows a grid of 3 quick actions: Note, Camera, Document
    private var smallWidget: some View {
        VStack(spacing: 10) {
            // Quick note — primary action
            Link(destination: DeepLinks.quickNote) {
                HStack(spacing: 6) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(WidgetColors.accent)
                    Text("Quick Note")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(WidgetColors.textPrimary)
                    Spacer()
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(WidgetColors.surfaceInput)
                .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            // Camera + Document row
            HStack(spacing: 8) {
                Link(destination: DeepLinks.camera) {
                    HStack(spacing: 4) {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 14))
                        Text("Photo")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(WidgetColors.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(WidgetColors.surfaceInput)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                Link(destination: DeepLinks.document) {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 14))
                        Text("File")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .foregroundColor(WidgetColors.textSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(WidgetColors.surfaceInput)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
            }
        }
        .padding(12)
        .containerBackground(for: .widget) {
            WidgetColors.surfaceRaised
        }
    }

    // MARK: - Medium Widget (4x2)
    // Search-bar style with camera and document buttons
    private var mediumWidget: some View {
        HStack(spacing: 8) {
            // App icon area
            Image("WidgetIcon")
                .resizable()
                .frame(width: 28, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 6))

            // Tappable "input" area
            Link(destination: DeepLinks.quickNote) {
                HStack {
                    Text("Save a thought…")
                        .font(.system(size: 14))
                        .foregroundColor(WidgetColors.textSecondary)
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(WidgetColors.surfaceInput)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            // Camera button
            Link(destination: DeepLinks.camera) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 16))
                    .foregroundColor(WidgetColors.textSecondary)
                    .frame(width: 36, height: 36)
            }

            // Document button
            Link(destination: DeepLinks.document) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 16))
                    .foregroundColor(WidgetColors.textSecondary)
                    .frame(width: 36, height: 36)
            }
        }
        .padding(.horizontal, 12)
        .containerBackground(for: .widget) {
            WidgetColors.surfaceRaised
        }
    }

    // MARK: - Lock Screen Widget
    private var lockScreenWidget: some View {
        Link(destination: DeepLinks.quickNote) {
            HStack(spacing: 6) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 14, weight: .medium))
                Text("Quick Note")
                    .font(.system(size: 13, weight: .semibold))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .containerBackground(for: .widget) {
            Color.clear
        }
    }
}

// MARK: - Widget Configuration

@main
struct QuickNoteWidgetBundle: Widget {
    let kind: String = "QuickNoteWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: QuickNoteProvider()) { entry in
            QuickNoteWidgetView(entry: entry)
        }
        .configurationDisplayName("Quick Note")
        .description("Quickly save a thought to SaveItForL8r")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

// MARK: - Previews

#if DEBUG
struct QuickNoteWidget_Previews: PreviewProvider {
    static var previews: some View {
        QuickNoteWidgetView(entry: QuickNoteEntry(date: Date()))
            .previewContext(WidgetPreviewContext(family: .systemMedium))

        QuickNoteWidgetView(entry: QuickNoteEntry(date: Date()))
            .previewContext(WidgetPreviewContext(family: .systemSmall))

        QuickNoteWidgetView(entry: QuickNoteEntry(date: Date()))
            .previewContext(WidgetPreviewContext(family: .accessoryRectangular))
    }
}
#endif

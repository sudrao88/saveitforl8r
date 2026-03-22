import WidgetKit
import SwiftUI

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
    private var smallWidget: some View {
        Link(destination: URL(string: "com.saveitforl8r.app://quick-note")!) {
            VStack(spacing: 8) {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 28, weight: .medium))
                    .foregroundColor(Color(red: 0.145, green: 0.388, blue: 0.922)) // #2563EB
                Text("Quick Note")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(Color(red: 0.953, green: 0.957, blue: 0.965)) // #F3F4F6
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .containerBackground(for: .widget) {
            Color(red: 0.122, green: 0.161, blue: 0.216) // #1F2937
        }
    }

    // MARK: - Medium Widget (4x2)
    private var mediumWidget: some View {
        HStack(spacing: 12) {
            // App icon area
            Image("WidgetIcon")
                .resizable()
                .frame(width: 28, height: 28)
                .clipShape(RoundedRectangle(cornerRadius: 6))

            // Tappable "input" area
            Link(destination: URL(string: "com.saveitforl8r.app://quick-note")!) {
                HStack {
                    Text("Save a thought…")
                        .font(.system(size: 14))
                        .foregroundColor(Color(red: 0.612, green: 0.639, blue: 0.686)) // #9CA3AF
                    Spacer()
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color(red: 0.067, green: 0.094, blue: 0.153)) // #111827
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }

            // Camera button
            Link(destination: URL(string: "com.saveitforl8r.app://quick-note?mode=camera")!) {
                Image(systemName: "camera.fill")
                    .font(.system(size: 16))
                    .foregroundColor(Color(red: 0.612, green: 0.639, blue: 0.686)) // #9CA3AF
                    .frame(width: 36, height: 36)
            }
        }
        .padding(.horizontal, 12)
        .containerBackground(for: .widget) {
            Color(red: 0.122, green: 0.161, blue: 0.216) // #1F2937
        }
    }

    // MARK: - Lock Screen Widget
    private var lockScreenWidget: some View {
        Link(destination: URL(string: "com.saveitforl8r.app://quick-note")!) {
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

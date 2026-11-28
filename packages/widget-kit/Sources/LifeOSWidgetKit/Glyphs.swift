import Foundation

public enum Glyphs {
    public static let rows = 7

    public static let grid: [Character: [String]] = [
        "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
        "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
        "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
        "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
        "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
        "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
        "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
        "7": ["#####", "....#", "...#.", "..#..", "..#..", "..#..", "..#.."],
        "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
        "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
        ":": [".", ".", "#", ".", "#", ".", "."],
    ]

    public struct Dot: Hashable, Sendable {
        public let x: Int
        public let y: Int
    }

    public static func dots(_ value: String) -> (dots: [Dot], columns: Int) {
        var column = 0
        var lit: [Dot] = []
        for character in value {
            guard let rows = grid[character] else { continue }
            for (y, row) in rows.enumerated() {
                for (x, cell) in row.enumerated() where cell == "#" {
                    lit.append(Dot(x: column + x, y: y))
                }
            }
            column += (rows.first?.count ?? 0) + 1
        }
        return (lit, max(0, column - 1))
    }
}

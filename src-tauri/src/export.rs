//! Turning a manuscript into files for other people: plain text, and a Word
//! document in standard manuscript format (the layout agents and editors
//! expect: 12 pt Times New Roman, double-spaced, half-inch paragraph indents,
//! each chapter on a new page, "#" for scene breaks).

use docx_rs::{
    AlignmentType, BreakType, Docx, LineSpacing, PageMargin, Paragraph, Run, RunFonts,
    SpecialIndentType,
};

/// One piece of the manuscript.
#[derive(Debug, PartialEq)]
pub enum Block {
    Chapter(String),
    Scene,
    Para(String),
}

/// Read the manuscript format: "# " starts a chapter, "* * *" is a scene
/// break, blank lines separate paragraphs.
pub fn parse(manuscript: &str) -> Vec<Block> {
    let mut out = vec![];
    let mut cur: Vec<&str> = vec![];
    let flush = |cur: &mut Vec<&str>, out: &mut Vec<Block>| {
        if !cur.is_empty() {
            out.push(Block::Para(cur.join(" ")));
            cur.clear();
        }
    };
    for line in manuscript.lines() {
        let t = line.trim();
        let is_scene = {
            let s: String = t.chars().filter(|c| !c.is_whitespace()).collect();
            s == "***" || t == "⁂" || t == "~"
        };
        if let Some(rest) = t.strip_prefix('#') {
            flush(&mut cur, &mut out);
            out.push(Block::Chapter(rest.trim_start_matches('#').trim().to_string()));
        } else if is_scene {
            flush(&mut cur, &mut out);
            out.push(Block::Scene);
        } else if t.is_empty() {
            flush(&mut cur, &mut out);
        } else {
            cur.push(t);
        }
    }
    flush(&mut cur, &mut out);
    out
}

/// Split "plain *italic* plain" into (text, italic) pieces. An asterisk
/// without a partner stays a literal asterisk.
pub fn inline(text: &str) -> Vec<(String, bool)> {
    let starts: Vec<usize> = text.match_indices('*').map(|(i, _)| i).collect();
    let pairs = starts.len() / 2 * 2; // ignore a final unpaired asterisk
    let mut out = vec![];
    let mut last = 0;
    let mut italic = false;
    for &i in starts.iter().take(pairs) {
        if i > last {
            out.push((text[last..i].to_string(), italic));
        }
        italic = !italic;
        last = i + 1;
    }
    if last < text.len() {
        out.push((text[last..].to_string(), false));
    }
    out.retain(|(t, _)| !t.is_empty());
    out
}

pub fn to_docx(manuscript: &str, title: &str, author: &str) -> Result<Vec<u8>, String> {
    let double = || LineSpacing::new().line(480);
    let centered = |text: &str| {
        Paragraph::new()
            .align(AlignmentType::Center)
            .line_spacing(double())
            .add_run(Run::new().add_text(text))
    };

    let mut doc = Docx::new()
        .default_fonts(
            RunFonts::new()
                .ascii("Times New Roman")
                .hi_ansi("Times New Roman")
                .cs("Times New Roman")
                .east_asia("Times New Roman"),
        )
        .default_size(24) // half-points: 12 pt
        .page_margin(PageMargin::new().top(1440).bottom(1440).left(1440).right(1440));

    // Title page
    let mut blank = Paragraph::new().line_spacing(double());
    for _ in 0..8 {
        blank = blank.add_run(Run::new().add_break(BreakType::TextWrapping));
    }
    doc = doc.add_paragraph(blank);
    doc = doc.add_paragraph(centered(if title.trim().is_empty() { "Untitled" } else { title }));
    if !author.trim().is_empty() {
        doc = doc.add_paragraph(centered(&format!("by {author}")));
    }

    let mut chapter_no = 0;
    let mut first_after_break = true;
    let mut need_page_break = true; // the first block starts after the title page
    for block in parse(manuscript) {
        match block {
            Block::Chapter(name) => {
                chapter_no += 1;
                let mut p = centered(&format!("Chapter {chapter_no}")).page_break_before(true);
                for _ in 0..3 {
                    p = p.add_run(Run::new().add_break(BreakType::TextWrapping));
                }
                doc = doc.add_paragraph(p);
                if !name.is_empty() {
                    doc = doc.add_paragraph(centered(&name));
                }
                first_after_break = true;
                need_page_break = false;
            }
            Block::Scene => {
                doc = doc.add_paragraph(centered("#"));
                first_after_break = true;
            }
            Block::Para(text) => {
                let mut p = Paragraph::new().line_spacing(double());
                if !first_after_break {
                    p = p.indent(None, Some(SpecialIndentType::FirstLine(720)), None, None);
                }
                if need_page_break {
                    p = p.page_break_before(true);
                    need_page_break = false;
                }
                for (piece, italic) in inline(&text) {
                    let mut r = Run::new().add_text(piece);
                    if italic {
                        r = r.italic();
                    }
                    p = p.add_run(r);
                }
                doc = doc.add_paragraph(p);
                first_after_break = false;
            }
        }
    }
    doc = doc.add_paragraph(centered("# # #").page_break_before(false));

    let mut buf = std::io::Cursor::new(Vec::new());
    doc.build().pack(&mut buf).map_err(|e| format!("Could not build the Word file: {e}"))?;
    Ok(buf.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_chapters_scenes_and_paragraphs() {
        let b = parse("# One\n\nFirst line\ncontinues.\n\n* * *\n\nSecond.\n");
        assert_eq!(
            b,
            vec![
                Block::Chapter("One".into()),
                Block::Para("First line continues.".into()),
                Block::Scene,
                Block::Para("Second.".into())
            ]
        );
    }

    #[test]
    fn italics_and_stray_asterisks() {
        assert_eq!(
            inline("a *b* c"),
            vec![("a ".into(), false), ("b".into(), true), (" c".into(), false)]
        );
        assert_eq!(inline("5 * 3"), vec![("5 * 3".into(), false)]);
    }

    #[test]
    fn builds_a_word_file() {
        let bytes = to_docx("# One\n\nHello *there*.\n\n* * *\n\nBye.", "Book", "Me").unwrap();
        assert!(bytes.starts_with(b"PK")); // a .docx is a zip archive
    }
}

#[cfg(test)]
mod sample_file {
    /// Writes a sample Word file to the temp folder for a visual check.
    #[test]
    #[ignore]
    fn write_sample_docx() {
        let ms = std::fs::read_to_string(std::env::var("GP_SAMPLE").unwrap()).unwrap();
        let bytes = super::to_docx(&ms, "The Weatherglass", "Your Name").unwrap();
        std::fs::write(std::env::temp_dir().join("gp-sample.docx"), bytes).unwrap();
    }
}

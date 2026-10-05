"""One local file in, one JSON result out. Run with the isolated SDK's Python -I."""

from __future__ import annotations

import contextlib
from importlib.metadata import distribution
import io
import json
from pathlib import Path, PurePosixPath
import posixpath
import re
import sys
from urllib.parse import unquote, urlsplit
import uuid
import warnings
import zipfile

SDK_VERSION = "0.1.6b2"
SDK_COMMIT = "a51f725d7ff4cdfe3bb6ad2ce2c04d98bf5f1f00"
SDK_SOURCE = "https://github.com/konglong-pro/markitdown.git"
MAX_INPUT_BYTES = 50 * 1024 * 1024
MAX_MARKDOWN_BYTES = 10 * 1024 * 1024
MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 10000
MAX_CHAPTERS = 1000
ALLOWED_EXTENSIONS = frozenset(
    (".docx", ".pptx", ".xlsx", ".xls", ".pdf", ".html", ".htm", ".txt", ".csv", ".json", ".xml", ".epub")
)
ARCHIVE_EXTENSIONS = frozenset((".docx", ".pptx", ".xlsx", ".epub"))


class WorkerError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def block_external_io(event: str, args: tuple) -> None:
    """Converters must never contact a server or spawn an external converter."""
    if event in ("socket.connect", "socket.bind", "socket.getaddrinfo", "subprocess.Popen", "os.system", "os.posix_spawn"):
        raise WorkerError("external_access_blocked", "Document conversion cannot access the network or run external programs.")


class LocalOnlySession:
    def request(self, *args, **kwargs):
        raise WorkerError("external_access_blocked", "Only local files can be converted.")

    get = post = put = delete = head = patch = request


def check_archive(data: bytes, extension: str) -> None:
    archive_like = zipfile.is_zipfile(io.BytesIO(data))
    if extension in ARCHIVE_EXTENSIONS and not archive_like:
        # Password-protected OOXML is an OLE container instead of a ZIP.
        if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            raise WorkerError("encrypted_document", "This document is encrypted. Save an unencrypted copy and import it again.")
        raise WorkerError("invalid_document", "The file does not contain a valid document archive.")
    if not archive_like:
        return
    if extension not in ARCHIVE_EXTENSIONS:
        raise WorkerError("invalid_document", "The file content does not match its selected document format.")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > MAX_ARCHIVE_ENTRIES:
                raise WorkerError("unsafe_archive", "This document contains too many archive entries.")
            expanded_bytes = 0
            seen = set()
            for entry in entries:
                path = PurePosixPath(entry.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or ":" in entry.filename or entry.filename in seen:
                    raise WorkerError("unsafe_archive", "This document contains unsafe or duplicate archive paths.")
                seen.add(entry.filename)
                if entry.flag_bits & 1:
                    raise WorkerError("encrypted_document", "This document is encrypted. Save an unencrypted copy and import it again.")
                expanded_bytes += entry.file_size
                if expanded_bytes > MAX_ARCHIVE_BYTES or entry.file_size > MAX_ARCHIVE_BYTES:
                    raise WorkerError("unsafe_archive", "This document expands beyond the 200 MiB conversion limit.")
                if entry.file_size > 1024 * 1024 and entry.file_size / max(1, entry.compress_size) > 1000:
                    raise WorkerError("unsafe_archive", "This document has an unsafe archive compression ratio.")
                if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise WorkerError("unsafe_archive", "This document uses an unsupported archive compression method.")
    except zipfile.BadZipFile as error:
        raise WorkerError("invalid_document", "The document archive is damaged.") from error


def sdk():
    from markitdown import MarkItDown, StreamInfo, __version__
    from markitdown import converters

    direct_url = distribution("markitdown").read_text("direct_url.json")
    provenance = json.loads(direct_url) if direct_url else {}
    if (
        __version__ != SDK_VERSION
        or provenance.get("url") != SDK_SOURCE
        or provenance.get("vcs_info", {}).get("commit_id") != SDK_COMMIT
        or provenance.get("subdirectory") != "packages/markitdown"
    ):
        raise WorkerError("sdk_version_mismatch", "Run the Babel document converter setup to install the pinned SDK version.")
    return MarkItDown, StreamInfo, converters


def epub_path(source: str, href: str) -> tuple[str, str]:
    """Resolve inside the ZIP, never against the staged file's filesystem."""
    parsed = urlsplit(href)
    decoded = unquote(parsed.path).replace("\\", "/")
    if parsed.scheme or parsed.netloc or decoded.startswith("/") or ":" in decoded or "\x00" in decoded:
        raise WorkerError("unsafe_archive", "This EPUB contains an unsafe content reference.")
    path = posixpath.normpath(posixpath.join(posixpath.dirname(source), decoded)) if decoded else source
    if path == ".." or path.startswith("../"):
        raise WorkerError("unsafe_archive", "This EPUB contains a content reference outside its archive.")
    return path, unquote(parsed.fragment)


def convert_epub(data: bytes, converters, StreamInfo):
    """Read the book's spine and TOC while using the pinned SDK for HTML text."""
    from bs4 import BeautifulSoup
    from defusedxml import ElementTree
    from markitdown import DocumentConverterResult

    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        container = ElementTree.fromstring(archive.read("META-INF/container.xml"))
        rootfile = container.find(".//{*}rootfile")
        if rootfile is None:
            raise WorkerError("invalid_document", "This EPUB has no content manifest.")
        opf_path, _ = epub_path("", rootfile.attrib.get("full-path", ""))
        package = ElementTree.fromstring(archive.read(opf_path))
        title_node = package.find(".//{*}metadata/{*}title")
        title = "".join(title_node.itertext()).strip() if title_node is not None else None
        manifest = {item.attrib.get("id"): item for item in package.findall(".//{*}manifest/{*}item")}
        spine = package.find(".//{*}spine")
        if spine is None:
            raise WorkerError("invalid_document", "This EPUB has no reading order.")

        toc = []
        nav = next((item for item in manifest.values() if "nav" in item.attrib.get("properties", "").split()), None)
        if nav is not None:
            nav_path, _ = epub_path(opf_path, nav.attrib.get("href", ""))
            soup = BeautifulSoup(archive.read(nav_path), "html.parser")
            navigation = next((node for node in soup.find_all("nav")
                               if "toc" in str(node.get("epub:type", "")).split() or node.get("role") == "doc-toc"), None)
            if navigation is not None:
                for link in navigation.find_all("a", href=True):
                    toc.append((*epub_path(nav_path, link["href"]), link.get_text(" ", strip=True)))
        if not toc:
            ncx = manifest.get(spine.attrib.get("toc"))
            if ncx is None:
                ncx = next((item for item in manifest.values() if item.attrib.get("media-type") == "application/x-dtbncx+xml"), None)
            if ncx is not None:
                ncx_path, _ = epub_path(opf_path, ncx.attrib.get("href", ""))
                navigation = ElementTree.fromstring(archive.read(ncx_path))
                for point in navigation.findall(".//{*}navPoint"):
                    content = point.find("{*}content")
                    label = point.find("{*}navLabel/{*}text")
                    if content is not None:
                        toc.append((*epub_path(ncx_path, content.attrib.get("src", "")),
                                    "".join(label.itertext()).strip() if label is not None else ""))

        chapters = []
        html_converter = converters.HtmlConverter()
        for itemref in spine.findall("{*}itemref"):
            item = manifest.get(itemref.attrib.get("idref"))
            if item is None:
                continue
            source_path, _ = epub_path(opf_path, item.attrib.get("href", ""))
            if item.attrib.get("media-type") not in ("application/xhtml+xml", "text/html"):
                continue
            soup = BeautifulSoup(archive.read(source_path), "html.parser")
            # Remove images in the DOM: a Markdown regex cannot reliably match
            # nested/escaped alt text or multiline image destinations.
            for image in soup.find_all(["img", "svg", "image"]):
                image.decompose()
            heading = soup.find(re.compile(r"^h[1-6]$"))
            fallback = heading.get_text(" ", strip=True) if heading else (soup.title.get_text(" ", strip=True) if soup.title else PurePosixPath(source_path).stem)
            labels = [(fragment, label) for path, fragment, label in toc if path == source_path]
            base_title = next((label for fragment, label in labels if not fragment and label), fallback)
            marker_prefix = "BABELCHAPTER" + uuid.uuid4().hex
            markers = {}
            seen_fragments = set()
            for fragment, label in labels:
                if not fragment or fragment in seen_fragments:
                    continue
                seen_fragments.add(fragment)
                target = soup.find(id=fragment) or soup.find("a", attrs={"name": fragment})
                if target is None:
                    continue
                marker = f"{marker_prefix}{len(markers)}"
                paragraph = soup.new_tag("p")
                paragraph.string = marker
                target.insert_before(paragraph)
                markers[marker] = label or target.get_text(" ", strip=True) or fallback
            converted = html_converter.convert(io.BytesIO(str(soup).encode("utf-8")),
                                               StreamInfo(extension=".html", mimetype="text/html", charset="utf-8"))
            parts = re.split(rf"(?m)^[^\n]*({marker_prefix}\d+)[^\n]*(?:\n|$)", converted.markdown)
            current_title = base_title
            for index, part in enumerate(parts):
                if index % 2:
                    current_title = markers[part]
                elif part.strip():
                    if index == 0 and markers:
                        current_title = f"{title or fallback} — Introduction"
                    chapters.append({"title": current_title[:500], "markdown": part.replace("\x00", "").strip()})
            if len(chapters) > MAX_CHAPTERS:
                raise WorkerError("output_too_large", "An EPUB can contain at most 1,000 imported sections.")
        markdown = "\n\n".join(chapter["markdown"] for chapter in chapters)
        metadata = []
        for field in ("title", "creator", "language", "publisher", "date", "description", "identifier"):
            values = ["".join(node.itertext()).strip() for node in package.findall(f".//{{*}}metadata/{{*}}{field}")]
            if any(values):
                label = "Authors" if field == "creator" else field.capitalize()
                metadata.append(f"**{label}:** {', '.join(filter(None, values))}")
        if markdown and metadata:
            markdown = "\n".join(metadata) + "\n\n" + markdown
        return DocumentConverterResult(markdown=markdown, title=title), chapters, "epub-toc" if toc else "epub-spine"


def convert(input_path: str, extension: str) -> dict:
    extension = extension.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise WorkerError("unsupported_format", "This document format is not supported for Markdown import.")
    path = Path(input_path)
    if not path.is_absolute() or not path.is_file() or path.is_symlink():
        raise WorkerError("invalid_input", "A locally staged document file is required.")
    if path.stat().st_size > MAX_INPUT_BYTES:
        raise WorkerError("input_too_large", "Documents must be 50 MiB or smaller.")
    with path.open("rb") as source:
        data = source.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise WorkerError("input_too_large", "Documents must be 50 MiB or smaller.")
    if not data:
        raise WorkerError("empty_document", "The document is empty.")
    check_archive(data, extension)
    MarkItDown, StreamInfo, converters = sdk()
    converter_types = {
        ".docx": converters.DocxConverter,
        ".pptx": converters.PptxConverter,
        ".xlsx": converters.XlsxConverter,
        ".xls": converters.XlsConverter,
        ".pdf": converters.PdfConverter,
        ".html": converters.HtmlConverter,
        ".htm": converters.HtmlConverter,
        ".txt": converters.PlainTextConverter,
        ".csv": converters.CsvConverter,
        ".json": converters.PlainTextConverter,
        ".xml": converters.PlainTextConverter,
        ".epub": converters.EpubConverter,
    }
    sys.addaudithook(block_external_io)
    converter = MarkItDown(enable_builtins=False, enable_plugins=False, requests_session=LocalOnlySession())
    converter.register_converter(converter_types[extension]())
    # Never pass local_path or url: the SDK receives only the selected file bytes.
    mimetype = "text/plain" if extension == ".xml" else None
    messages = []
    chapters = None
    chapter_source = None
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter("always")
        if extension == ".epub":
            result, chapters, chapter_source = convert_epub(data, converters, StreamInfo)
        else:
            # All HTML-based adapters receive this option; EPUB uses its own
            # DOM pass above because the SDK doesn't forward options to HTML.
            result = converter.convert_stream(io.BytesIO(data), stream_info=StreamInfo(extension=extension, mimetype=mimetype), strip=["img", "svg", "image"])
    markdown = result.markdown.replace("\x00", "").strip()
    # HTML images are omitted before Markdown generation. The Node adapter also
    # parses image references in text/Markdown without altering code examples.
    if extension in (".json", ".xml") and markdown:
        # Structured text must remain visible and literal in Markdown readers.
        # In particular, raw XML would otherwise be treated as HTML and hidden.
        longest_run = max((len(run) for run in re.findall(r"`+", markdown)), default=0)
        fence = "`" * max(3, longest_run + 1)
        markdown = f"{fence}{extension[1:]}\n{markdown}\n{fence}"
    if extension in (".docx", ".pptx", ".pdf", ".epub", ".html", ".htm"):
        messages.append("Images are not imported automatically; add required images in the editor.")
    if extension in (".docx", ".pptx", ".xlsx", ".xls", ".pdf", ".epub"):
        messages.append("Complex layouts, tables and mathematical notation may need correction after conversion.")
    if extension == ".pdf":
        messages.append("Only PDF text is extracted. Scanned pages require OCR before import.")
    if captured:
        messages.append("The converter reported document compatibility warnings; review the Markdown before saving.")
    if not markdown.strip():
        if extension == ".pdf":
            raise WorkerError("no_extractable_text", "This PDF has no extractable text. Run OCR on scanned pages, then import the searchable PDF.")
        raise WorkerError("no_extractable_text", "No text could be extracted from this document.")
    if len(markdown.encode("utf-8")) > MAX_MARKDOWN_BYTES:
        raise WorkerError("output_too_large", "Converted Markdown exceeds the 10 MiB note limit.")
    title = result.title if isinstance(result.title, str) else None
    output = {"markdown": markdown, "title": title[:500] if title else None, "warnings": messages, "sdkVersion": SDK_VERSION}
    if chapters:
        output.update(chapters=chapters, chapterSource=chapter_source)
    return output


def main() -> int:
    # Isolated Python on Windows does not inherit PYTHONUTF8. Explicit encoding
    # keeps multilingual documents valid JSON over the Node subprocess pipe.
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if len(sys.argv) == 2 and sys.argv[1] == "--probe":
                sdk()
                result = {"ready": True, "sdkVersion": SDK_VERSION}
            elif len(sys.argv) == 3:
                result = convert(sys.argv[1], sys.argv[2])
            else:
                raise WorkerError("invalid_arguments", "Supply one absolute local input path and its document extension.")
        print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
        return 0
    except WorkerError as error:
        result = {"error": {"code": error.code, "message": str(error)}}
    except ImportError:
        result = {"error": {"code": "sdk_unavailable", "message": "Run the Babel document converter setup to install the local SDK."}}
    except Exception:
        # Do not expose staged paths, library stack traces, or document contents.
        result = {"error": {"code": "conversion_failed", "message": "The document could not be converted. Check that it is supported, unencrypted and not damaged."}}
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

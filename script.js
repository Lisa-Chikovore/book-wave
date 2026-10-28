



const $ = (id) => document.getElementById(id);


const synth = window.speechSynthesis;


const state = {
    segments: [],
    index: 0,
    playing: false,
    token: 0,
    fileName: "",
    voices: []
};



function info(message, error = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
}




function segmentText(text) {
    const cleaned = text
        .replace(/\r/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return (
        cleaned
            .match(/[\s\S]{1,190}(?:[.!?](?=\s|$)|(?=\s)|$)/g)
            ?.map((section) => section.trim())
            .filter(Boolean) || []
    );
}



function update() {
    const total = state.segments.length;

    const progress = total
        ? Math.round((100 * state.index) / total)
        : 0;

    $("fill").style.width = progress + "%";

    $("percent").textContent =
        progress + "% complete";

    $("count").textContent =
        (total ? Math.min(state.index + 1, total) : 0) +
        " / " +
        total +
        " sections";

    $("track").setAttribute(
        "aria-valuenow",
        String(progress)
    );

    $("play").textContent = state.playing
        ? "Ⅱ"
        : "▶";

    $("play").setAttribute(
        "aria-label",
        state.playing ? "Pause" : "Play"
    );

    $("chapter").textContent = total
        ? `Section ${Math.min(state.index + 1, total)} of ${total}`
        : "No content loaded";

    $("back").disabled = !total;
    $("next").disabled = !total;
}




function display() {
    const segments = state.segments;

    const start = Math.max(0, state.index - 5);
    const end = Math.min(
        segments.length,
        state.index + 15
    );

    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i++) {
        const span = document.createElement("span");

        span.textContent = segments[i] + " ";
        span.dataset.index = i;

        if (i === state.index) {
            span.className = "speaking";
        }

        fragment.append(span);
    }

    $("reading").replaceChildren(fragment);
    $("reading").scrollTop = 0;

    update();
}


function stop() {
    state.token++;

    synth.cancel();

    state.playing = false;

    update();
}




function speak() {
    if (
        !state.playing ||
        state.index >= state.segments.length
    ) {
        stop();
        return;
    }

    const token = state.token;

    const utterance = new SpeechSynthesisUtterance(
        state.segments[state.index]
    );

    
    utterance.rate = Number($("speed").value);

  
    const selectedVoice = state.voices.find(
        (voice) => voice.voiceURI === $("voice").value
    );

    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }

   
    utterance.onend = () => {
        if (
            token !== state.token ||
            !state.playing
        ) {
            return;
        }

        state.index++;

       
        if (state.index >= state.segments.length) {
            stop();

            info("Finished listening to your book.");

            display();
            return;
        }

        display();
        speak();
    };

    utterance.onerror = (event) => {
        if (token !== state.token) {
            return;
        }

        if (
            event.error === "interrupted" ||
            event.error === "canceled"
        ) {
            return;
        }

        stop();

        info(
            `Speech playback stopped: ${event.error}`,
            true
        );
    };

    display();
    synth.speak(utterance);
}




function playPause() {
    if (!state.segments.length) {
        return;
    }

    // Stop current speech
    if (state.playing) {
        stop();
        return;
    }

    
    if (state.index >= state.segments.length) {
        state.index = 0;
    }

    state.playing = true;
    state.token++;

    speak();
}




function jump(index) {
    const wasPlaying = state.playing;

    stop();

    state.index = Math.min(
        Math.max(index, 0),
        Math.max(state.segments.length - 1, 0)
    );

    display();

    // Continue playback if it was playing
    if (wasPlaying) {
        state.playing = true;
        state.token++;

        speak();
    }
}




function loadVoices() {
    state.voices = synth.getVoices();

    const previouslySelected = $("voice").value;

    $("voice").replaceChildren(
        new Option("Default Voice", "")
    );

    state.voices.forEach((voice) => {
        const option = new Option(
            `${voice.name} (${voice.lang})`,
            voice.voiceURI
        );

        $("voice").add(option);
    });

    if (
        state.voices.some(
            (voice) =>
                voice.voiceURI === previouslySelected
        )
    ) {
        $("voice").value = previouslySelected;
    }
}

loadVoices();

synth.onvoiceschanged = loadVoices;



async function readPDF(bytes) {
    const pdfjs = await import(
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs"
    );

    pdfjs.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

    const document = await pdfjs.getDocument({
        data: bytes
    }).promise;

    const pages = [];

    for (
        let pageNumber = 1;
        pageNumber <= document.numPages;
        pageNumber++
    ) {
        info(
            `Reading PDF page ${pageNumber} of ${document.numPages}…`
        );

        const page = await document.getPage(pageNumber);

        const content = await page.getTextContent();

        const pageText = content.items
            .map((item) => item.str || "")
            .join(" ");

        pages.push(pageText);
    }

    return pages.join("\n\n");
}




async function readEpub(bytes) {
    if (!window.ePub) {
        throw new Error(
            "EPUB library could not load. Check your internet connection."
        );
    }

    const book = ePub(
        bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        )
    );

    await book.ready;

    const sections = [];

    for (const section of book.spine.spineItems) {
        try {
            const document = await section.load(
                book.load.bind(book)
            );

            const text =
                (document.body || document.documentElement)
                    ?.textContent || "";

            if (text.trim()) {
                sections.push(text.trim());
            }

            section.unload();

        } catch (error) {
            console.warn(
                "Skipped EPUB section",
                error
            );
        }
    }

    book.destroy();

    return sections.join("\n\n");
}




async function readDocx(bytes) {
    if (!window.mammoth) {
        throw new Error(
            "DOCX library could not load. Check your internet connection."
        );
    }

    const result = await mammoth.extractRawText({
        arrayBuffer: bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength
        )
    });

    return result.value;
}



async function loadBook(file) {
    if (!file) {
        return;
    }

    stop();

    info("Opening your book…");

    try {
        const extension = file.name
            .split(".")
            .pop()
            .toLowerCase();

        const bytes = new Uint8Array(
            await file.arrayBuffer()
        );

        let text;

        switch (extension) {
            case "txt":
                text = new TextDecoder().decode(bytes);
                break;

            case "pdf":
                text = await readPDF(bytes);
                break;

            case "epub":
                text = await readEpub(bytes);
                break;

            case "docx":
                text = await readDocx(bytes);
                break;

            default:
                throw new Error(
                    "Unsupported format. Use PDF, EPUB, DOCX or TXT."
                );
        }

     
        const sections = segmentText(text);

        if (!sections.length) {
            throw new Error(
                "No readable text found. Scanned PDFs require OCR."
            );
        }

        state.segments = sections;
        state.index = 0;
        state.fileName = file.name;

   
        $("title").textContent = file.name;

        const wordCount = text
            .trim()
            .split(/\s+/)
            .length
            .toLocaleString();

        $("details").textContent =
            `${extension.toUpperCase()} · ${wordCount} words`;

        $("reader").classList.add("show");

        display();

        info(
            "Book loaded! Press play to start listening."
        );

        $("reader").scrollIntoView({
            behavior: "smooth",
            block: "start"
        });

    } catch (error) {
        console.error(error);

        info(
            "Could not open book: " + error.message,
            true
        );
    }
}




$("file").addEventListener("change", (event) => {
    loadBook(event.target.files[0]);
});

// Choose book button
$("choose").onclick = (event) => {
    event.stopPropagation();
    $("file").click();
};


$("replace").onclick = () => {
    $("file").click();
};

// Click upload area
$("drop").onclick = (event) => {
    if (event.target.id !== "choose") {
        $("file").click();
    }
};


$("drop").onkeydown = (event) => {
    if (
        event.key === "Enter" ||
        event.key === " "
    ) {
        event.preventDefault();
        $("file").click();
    }
};



for (const eventName of ["dragenter", "dragover"]) {
    $("drop").addEventListener(
        eventName,
        (event) => {
            event.preventDefault();

            $("drop").classList.add("drag");
        }
    );
}

for (const eventName of ["dragleave", "drop"]) {
    $("drop").addEventListener(
        eventName,
        (event) => {
            event.preventDefault();

            $("drop").classList.remove("drag");
        }
    );
}

$("drop").addEventListener("drop", (event) => {
    loadBook(event.dataTransfer.files[0]);
});



$("play").onclick = playPause;

// Skip backwards five sections
$("back").onclick = () => {
    jump(state.index - 5);
};


$("next").onclick = () => {
    jump(state.index + 5);
};

// Restart book
$("restart").onclick = () => {
    jump(0);
};




$("speed").oninput = () => {
    const speed = Number($("speed").value);

    $("speedLabel").textContent =
        speed.toFixed(1) + "×";

    if (state.playing) {
        jump(state.index);
    }
};





$("voice").onchange = () => {
    if (state.playing) {
        jump(state.index);
    }
};




$("track").onclick = (event) => {
    if (!state.segments.length) {
        return;
    }

    const rectangle =
        event.currentTarget.getBoundingClientRect();

    const position =
        (event.clientX - rectangle.left) /
        rectangle.width;

    const sectionIndex = Math.floor(
        position * state.segments.length
    );

    jump(sectionIndex);
};



$("track").onkeydown = (event) => {
    if (
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight"
    ) {
        event.preventDefault();

        const direction =
            event.key === "ArrowRight" ? 5 : -5;

        jump(state.index + direction);
    }
};


update();

export interface PdfConversionResult {
    imageUrl: string;
    file: File | null;
    error?: string;
}

// Global variable to store PDF.js library
declare global {
    interface Window {
        pdfjsLib: any;
    }
}

let isLoading = false;
let loadPromise: Promise<any> | null = null;

async function loadPdfJsFromCDN(): Promise<any> {
    if (typeof window !== 'undefined' && window.pdfjsLib) {
        return window.pdfjsLib;
    }
    
    if (loadPromise) return loadPromise;

    isLoading = true;
    
    loadPromise = new Promise((resolve, reject) => {
        // Create script element for PDF.js
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs';
        script.type = 'module';
        
        script.onload = () => {
            console.log('PDF.js CDN script loaded');
            
            // The CDN version should expose pdfjsLib globally
            if (window.pdfjsLib) {
                // Set worker source
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
                console.log('PDF.js worker source set');
                isLoading = false;
                resolve(window.pdfjsLib);
            } else {
                // Try to import it as a module
                import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs')
                    .then((lib) => {
                        lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs';
                        window.pdfjsLib = lib;
                        isLoading = false;
                        resolve(lib);
                    })
                    .catch(reject);
            }
        };
        
        script.onerror = () => {
            console.error('Failed to load PDF.js from CDN');
            isLoading = false;
            loadPromise = null;
            reject(new Error('Failed to load PDF.js from CDN'));
        };
        
        document.head.appendChild(script);
    });

    return loadPromise;
}

async function loadPdfJsLocal(): Promise<any> {
    try {
        console.log('Attempting to load PDF.js locally...');
        
        // Try different import methods
        let lib;
        try {
            lib = await import("pdfjs-dist");
            console.log('PDF.js imported with standard import');
        } catch (e) {
            console.log('Standard import failed, trying build path...');
            lib = await import("pdfjs-dist/build/pdf.mjs");
            console.log('PDF.js imported with build path');
        }
        
        // Set the worker source
        if (lib.GlobalWorkerOptions) {
            lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            console.log('Worker source set to local file');
        }
        
        return lib;
    } catch (error) {
        console.error('Local PDF.js loading failed:', error);
        throw error;
    }
}

async function loadPdfJs(): Promise<any> {
    try {
        // Try local first
        return await loadPdfJsLocal();
    } catch (localError) {
        console.warn('Local PDF.js failed, trying CDN...', localError);
        try {
            return await loadPdfJsFromCDN();
        } catch (cdnError) {
            console.error('Both local and CDN PDF.js loading failed');
            throw new Error(`PDF.js loading failed: Local: ${localError.message}, CDN: ${cdnError.message}`);
        }
    }
}

export async function convertPdfToImage(
    file: File
): Promise<PdfConversionResult> {
    try {
        console.log('Starting PDF conversion for file:', file.name, 'Size:', file.size);
        
        // Validate file
        if (!file) {
            throw new Error('No file provided');
        }
        
        if (file.type !== 'application/pdf') {
            throw new Error(`Invalid file type: ${file.type}. Expected: application/pdf`);
        }
        
        if (file.size === 0) {
            throw new Error('File is empty');
        }
        
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            throw new Error('File is too large (max 50MB)');
        }
        
        const lib = await loadPdfJs();
        console.log('PDF.js library loaded successfully');

        const arrayBuffer = await file.arrayBuffer();
        console.log('File converted to array buffer, size:', arrayBuffer.byteLength);
        
        const loadingTask = lib.getDocument({ 
            data: arrayBuffer,
            verbosity: 0,
            isEvalSupported: false,
        });
        
        const pdf = await loadingTask.promise;
        console.log('PDF document loaded, pages:', pdf.numPages);
        
        if (pdf.numPages === 0) {
            throw new Error('PDF has no pages');
        }
        
        const page = await pdf.getPage(1);
        console.log('First page loaded');

        // Use a reasonable scale
        const scale = 2.0;
        const viewport = page.getViewport({ scale });
        
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });

        if (!context) {
            throw new Error("Failed to get 2D context from canvas");
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        console.log('Canvas dimensions:', canvas.width, 'x', canvas.height);

        // Set white background
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";

        console.log('Starting page render...');
        const renderTask = page.render({ 
            canvasContext: context, 
            viewport,
            background: 'white'
        });
        
        await renderTask.promise;
        console.log('Page rendered successfully');

        return new Promise((resolve) => {
            console.log('Converting canvas to blob...');
            canvas.toBlob(
                (blob) => {
                    if (blob && blob.size > 0) {
                        console.log('Blob created successfully, size:', blob.size);
                        
                        const originalName = file.name.replace(/\.pdf$/i, "");
                        const imageFile = new File([blob], `${originalName}.png`, {
                            type: "image/png",
                        });

                        console.log('Image file created:', imageFile.name, 'Size:', imageFile.size);
                        resolve({
                            imageUrl: URL.createObjectURL(blob),
                            file: imageFile,
                        });
                    } else {
                        console.error('Failed to create blob from canvas or blob is empty');
                        resolve({
                            imageUrl: "",
                            file: null,
                            error: "Failed to create image blob or blob is empty",
                        });
                    }
                },
                "image/png",
                0.95
            );
        });
    } catch (err) {
        console.error('PDF conversion error:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
            imageUrl: "",
            file: null,
            error: errorMessage,
        };
    }
}
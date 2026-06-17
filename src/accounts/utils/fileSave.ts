type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: {
      description: string;
      accept: Record<string, string[]>;
    }[];
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

export async function saveBlob(
  filename: string,
  blob: Blob,
  pickerType: {
    description: string;
    mimeType: string;
    extensions: string[];
  }
) {
  if (await saveBlobWithPicker(filename, blob, pickerType)) {
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function saveBlobWithPicker(
  filename: string,
  blob: Blob,
  pickerType: {
    description: string;
    mimeType: string;
    extensions: string[];
  }
) {
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;

  if (!picker) {
    return false;
  }

  try {
    const handle = await picker({
      suggestedName: filename,
      types: [
        {
          description: pickerType.description,
          accept: {
            [pickerType.mimeType]: pickerType.extensions,
          },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return true;
    }

    console.error("save file error:", error);
    return false;
  }
}

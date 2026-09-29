"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import geminiZustand from "@/utils/gemini-zustand";
import { useParams, useRouter } from "next/navigation";
import { createChat } from "@/actions/actions";
import { nanoid } from "nanoid";
import { useMeasure } from "react-use";
import { User } from "next-auth";
import InputActions from "./input-actions";
import Link from "next/link";
import { MdImageSearch } from "react-icons/md";
import { IoMdClose } from "react-icons/io";

const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const InputPrompt = ({ user }: { user?: User }) => {
  const {
    currChat,
    setCurrChat,
    setToast,
    customPrompt,
    setInputImgName,
    inputImgName,
    setMsgLoader,
    prevChat,
    msgLoader,
    optimisticResponse,
    setUserData,
    setOptimisticResponse,
    setOptimisticPrompt,
  } = geminiZustand();

  const [inputImg, setInputImg] = useState<File | null>(null);

  const { chat } = useParams();
  const router = useRouter();
  const [inputRref, { height }] = useMeasure<HTMLTextAreaElement>();

  const chatID = (chat as string) || nanoid();

  const abortControllerRef = useRef<AbortController | null>(null);

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        if (typeof reader.result !== "string") {
          reject(new Error("Unable to read image"));
          return;
        }

        const base64 = reader.result.split(",")[1];

        if (!base64) {
          reject(new Error("Invalid image data"));
          return;
        }

        resolve(base64);
      };

      reader.onerror = () => {
        reject(new Error("Failed to read image"));
      };

      reader.readAsDataURL(file);
    });
  };

  const generateMsg = useCallback(async () => {
    if (!currChat.userPrompt?.trim() || !user) {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    router.push(`/app/${chatID}#new-chat`);

    const date = new Date().toISOString().split("T")[0];

    const rawPrompt = currChat.userPrompt;
    const rawImage = inputImgName;

    const detailedPrompt = `
Date: ${date}

${
  customPrompt.prompt
    ? customPrompt.prompt
    : `User is seeking a wise and impressive response. Consider including necessary details, context, and thoughtful insights. Aim to provide a comprehensive, well-structured, and articulate answer. Respond in a friendly and natural manner, using terms like "buddy" or other friendly expressions. Provide a complete and final response without asking any further questions.`
}

Previous chats:
User: ${prevChat.userPrompt || ""}

LLM Response:
${prevChat.llmResponse || ""}

Current User Query:
${rawPrompt}
`;

    try {
      setMsgLoader(true);

      let imageData:
        | {
            data: string;
            mimeType: string;
          }
        | undefined;

      if (inputImg) {
        if (!ALLOWED_IMAGE_TYPES.has(inputImg.type)) {
          setToast("Unsupported image type.");
          return;
        }

        if (inputImg.size > MAX_IMAGE_SIZE) {
          setToast("Image size must be 8 MB or less.");
          return;
        }

        imageData = {
          data: await fileToBase64(inputImg),
          mimeType: inputImg.type,
        };
      }

      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: detailedPrompt,
          image: imageData,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMessage = "Failed to generate Gemini response";

        try {
          const errorData = await response.json();

          if (errorData?.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // Ignore invalid error response.
        }

        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error("Gemini response stream is unavailable");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let text = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });

        if (chunk) {
          text += chunk;
          setCurrChat("llmResponse", text);
        }
      }

      text += decoder.decode();

      if (!text.trim()) {
        throw new Error("Gemini returned an empty response");
      }

      if (controller.signal.aborted) {
        return;
      }

      setOptimisticPrompt(rawPrompt);
      setOptimisticResponse(text);
      setCurrChat("userPrompt", null);

      await createChat({
        chatID,
        userID: user.id as string,
        imgName: rawImage ?? undefined,
        userPrompt: rawPrompt,
        llmResponse: text,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.error("Error generating message:", error);

      setToast(
        error instanceof Error
          ? error.message
          : "Something went wrong while generating the response."
      );
    } finally {
      abortControllerRef.current = null;
      setMsgLoader(false);
      setInputImg(null);
      setInputImgName(null);
      setCurrChat("userPrompt", null);
      setCurrChat("llmResponse", null);
      setOptimisticResponse(null);
      setOptimisticPrompt(null);
    }
  }, [
    currChat.userPrompt,
    user,
    chatID,
    inputImg,
    inputImgName,
    customPrompt.prompt,
    prevChat.userPrompt,
    prevChat.llmResponse,
    router,
    setCurrChat,
    setMsgLoader,
    setToast,
    setInputImgName,
    setOptimisticResponse,
    setOptimisticPrompt,
  ]);

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setCurrChat("userPrompt", e.target.value);
    },
    [setCurrChat]
  );

  const handleCancel = useCallback(() => {
    abortControllerRef.current?.abort();

    setOptimisticResponse("User has aborted the request");
    setMsgLoader(false);
  }, [setOptimisticResponse, setMsgLoader]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!user) {
        setToast("Please sign in to use Gemini!");
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        generateMsg();
      }
    },
    [generateMsg, setToast, user]
  );

  useEffect(() => {
    if (user) {
      setUserData(user);
    }
  }, [user, setUserData]);

  const handleImageUpload = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!event.target.files?.length) {
      return;
    }

    const file = event.target.files[0];

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setToast("Only JPG, PNG, WEBP and GIF images are supported.");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setToast("Image size must be 8 MB or less.");
      return;
    }

    setInputImg(file);
    setInputImgName(file.name);
  };

  return (
    <div className="flex-shrink-0 w-full md:px-10 px-5 pb-2 space-y-2 bg-white dark:bg-[#131314]">
      {inputImgName && (
        <div className="max-w-4xl overflow-hidden w-full mx-auto">
          <div className="p-5 w-fit relative max-w-full overflow-hidden bg-rtlLight group dark:bg-rtlDark rounded-t-3xl flex items-start gap-2">
            <MdImageSearch className="text-4xl" />

            <p className="text-lg font-semibold truncate">
              {inputImgName}
            </p>

            <IoMdClose
              onClick={() => {
                setInputImgName(null);
                setInputImg(null);
              }}
              className="absolute top-1 right-1 text-2xl rounded-full cursor-pointer hover:opacity-100 hidden group-hover:block opacity-80 bg-accentGray/40 p-1"
            />
          </div>
        </div>
      )}

      <div
        className={`w-full md:border-8 border-4 relative border-rtlLight dark:border-rtlDark max-w-4xl mx-auto min-h-16 md:rounded-[50px] rounded-2xl ${
          inputImgName && " !rounded-tl-none "
        } overflow-hidden bg-rtlLight dark:bg-rtlDark flex gap-1 md:items-center md:justify-between md:flex-row flex-col`}
      >
        <textarea
          name="prompt"
          ref={inputRref}
          disabled={msgLoader}
          placeholder={
            customPrompt.placeholder
              ? customPrompt.placeholder
              : "Enter a prompt here"
          }
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          value={
            optimisticResponse || msgLoader
              ? ""
              : currChat.userPrompt || ""
          }
          style={{ height }}
          className="flex-1 bg-transparent rounded-4xl p-2 pl-6 outline-none text-lg max-h-56 resize-none"
        />

        <InputActions
          handleCancel={handleCancel}
          handleImageUpload={handleImageUpload}
          generateMsg={generateMsg}
        />
      </div>

      <p className="text-xs font-light opacity-80 text-center">
        Gemini may display inaccurate info, including about people, so
        double-check its responses.{" "}
        <Link className="underline" href="/">
          Your privacy & Gemini Apps
        </Link>
      </p>
    </div>
  );
};

export default InputPrompt;

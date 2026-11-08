"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { FormAction } from "@/lib/action-result";
import { type CustomQuestion, MAX_CUSTOM_QUESTIONS } from "@/lib/event-questions";

export type EventFormValues = {
  title: string;
  descriptionMd: string;
  coverUrl: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  priceRupees: number;
  registrationOpensAt: string;
  registrationClosesAt: string;
  checkinOpensBeforeHours: number;
  customQuestions: CustomQuestion[];
};

type EditableQuestion = CustomQuestion & { optionsText: string };

function toEditable(question: CustomQuestion): EditableQuestion {
  return { ...question, optionsText: question.options?.join(", ") ?? "" };
}

function toStored({ optionsText, ...question }: EditableQuestion): CustomQuestion {
  if (question.type !== "single_select") {
    return { ...question, options: undefined };
  }
  const options = optionsText
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
  return { ...question, options };
}

type Props = {
  action: FormAction;
  hiddenFields: Record<string, string>;
  defaults?: EventFormValues;
  submitLabel: string;
  priceLocked: boolean;
};

export function EventForm({ action, hiddenFields, defaults, submitLabel, priceLocked }: Props) {
  const [questions, setQuestions] = useState<EditableQuestion[]>(
    defaults?.customQuestions.map(toEditable) ?? [],
  );

  function change(index: number, patch: Partial<EditableQuestion>) {
    setQuestions((current) =>
      current.map((question, i) => (i === index ? { ...question, ...patch } : question)),
    );
  }

  function add() {
    setQuestions((current) => [
      ...current,
      {
        id: crypto.randomUUID().slice(0, 8),
        type: "short_text",
        label: "",
        required: false,
        optionsText: "",
      },
    ]);
  }

  const field = "grid gap-2";
  const input = "h-11";

  return (
    <ActionForm action={action} className="mt-6 grid gap-5">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input
        type="hidden"
        name="customQuestions"
        value={JSON.stringify(questions.map(toStored))}
      />

      <div className={field}>
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required maxLength={120} defaultValue={defaults?.title} className={input} />
      </div>
      <div className={field}>
        <Label htmlFor="descriptionMd">Description</Label>
        <Textarea id="descriptionMd" name="descriptionMd" required rows={7} defaultValue={defaults?.descriptionMd} />
        <p className="text-sm text-muted-foreground">
          You can use # headings, - lists, **bold**, *italics* and [links](https://example.com).
        </p>
      </div>
      <div className={field}>
        <Label htmlFor="venue">Venue</Label>
        <Input id="venue" name="venue" required defaultValue={defaults?.venue} className={input} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <div className={field}>
          <Label htmlFor="startsAt">Starts</Label>
          <Input id="startsAt" name="startsAt" type="datetime-local" required defaultValue={defaults?.startsAt} className={input} />
        </div>
        <div className={field}>
          <Label htmlFor="endsAt">Ends</Label>
          <Input id="endsAt" name="endsAt" type="datetime-local" required defaultValue={defaults?.endsAt} className={input} />
        </div>
        <div className={field}>
          <Label htmlFor="capacity">Capacity</Label>
          <Input id="capacity" name="capacity" type="number" min={1} required defaultValue={defaults?.capacity ?? 100} className={input} />
        </div>
        <div className={field}>
          <Label htmlFor="priceRupees">Price in ₹ (0 for free)</Label>
          <Input
            id="priceRupees"
            name="priceRupees"
            type="number"
            min={0}
            step="0.01"
            required
            readOnly={priceLocked}
            defaultValue={defaults?.priceRupees ?? 0}
            className={input}
          />
        </div>
        <div className={field}>
          <Label htmlFor="registrationOpensAt">Registration opens (optional)</Label>
          <Input id="registrationOpensAt" name="registrationOpensAt" type="datetime-local" defaultValue={defaults?.registrationOpensAt} className={input} />
        </div>
        <div className={field}>
          <Label htmlFor="registrationClosesAt">Registration closes (optional)</Label>
          <Input id="registrationClosesAt" name="registrationClosesAt" type="datetime-local" defaultValue={defaults?.registrationClosesAt} className={input} />
        </div>
      </div>
      <div className={field}>
        <Label htmlFor="checkinOpensBeforeHours">Check-in opens this many hours early</Label>
        <Input id="checkinOpensBeforeHours" name="checkinOpensBeforeHours" type="number" min={0} max={48} step="0.5" required defaultValue={defaults?.checkinOpensBeforeHours ?? 2} className={input} />
      </div>
      <div className={field}>
        <Label htmlFor="coverUrl">Cover image link (optional)</Label>
        <Input id="coverUrl" name="coverUrl" type="url" placeholder="https://" defaultValue={defaults?.coverUrl} className={input} />
      </div>

      <section className="grid gap-4">
        <h2 className="font-heading text-3xl font-black">Registration questions</h2>
        {questions.map((question, index) => (
          <div key={question.id} className="grid gap-3 rounded-lg border p-3">
            <Input
              aria-label={`Question ${index + 1}`}
              placeholder="Question, such as Team name"
              value={question.label}
              onChange={(event) => change(index, { label: event.target.value })}
              className={input}
            />
            <NativeSelect
              aria-label={`Answer type for question ${index + 1}`}
              value={question.type}
              onChange={(event) =>
                change(index, { type: event.target.value as CustomQuestion["type"] })
              }
            >
              <option value="short_text">Short answer</option>
              <option value="single_select">Dropdown</option>
              <option value="checkbox">Checkbox</option>
            </NativeSelect>
            {question.type === "single_select" && (
              <Input
                aria-label={`Options for question ${index + 1}`}
                placeholder="Options, separated by commas"
                value={question.optionsText}
                onChange={(event) => change(index, { optionsText: event.target.value })}
                className={input}
              />
            )}
            <div className="flex items-center justify-between">
              <label className="flex min-h-11 items-center gap-3">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={(event) => change(index, { required: event.target.checked })}
                  className="size-5 accent-[var(--primary)]"
                />
                Required
              </label>
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-3"
                onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}
              >
                Remove question
              </Button>
            </div>
          </div>
        ))}
        {questions.length < MAX_CUSTOM_QUESTIONS && (
          <Button type="button" variant="outline" className="h-11 justify-self-start px-4" onClick={add}>
            Add a question
          </Button>
        )}
      </section>

      <Button type="submit" className="h-12 text-base">
        {submitLabel}
      </Button>
    </ActionForm>
  );
}

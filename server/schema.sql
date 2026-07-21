-- ============================================================
-- 설문 대시보드 스키마 (회사 Postgres, 전용 스키마 app_260712_tosb)
-- Fursys DB Studio의 SQL 실행 화면에서 그대로 실행하세요.
-- 스키마 자체는 이미 회사에서 만들어준 상태이므로 CREATE SCHEMA는 하지 않습니다.
-- 확장 함수(gen_random_uuid 등)는 권한이 없을 수 있어 사용하지 않고,
-- id/share_token은 애플리케이션(Node.js)에서 생성해 넣습니다.
-- ============================================================

create table if not exists app_260712_tosb.surveys (
  id           text primary key,
  title        text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  share_token  text unique not null
);

create table if not exists app_260712_tosb.survey_files (
  id            bigint generated always as identity primary key,
  survey_id     text not null references app_260712_tosb.surveys(id) on delete cascade,
  file_role     text not null check (file_role in ('codebook', 'value', 'label')),
  content       text not null default '',
  original_name text not null,
  file_size     bigint not null default 0,
  unique (survey_id, file_role)
);

-- 설문 목록 정렬 순서 등 전역 설정 저장용 (기존 Supabase Auth user_metadata 대체)
create table if not exists app_260712_tosb.app_settings (
  key   text primary key,
  value jsonb not null
);

-- 설문 분류 (컨설팅/리서치/기타). 기존 행 호환을 위해 NULL 허용(= 미분류).
alter table app_260712_tosb.surveys
  add column if not exists category text check (category in ('consulting', 'research', 'other'));

-- 기존에 만들어진 DB에 이미 category 컬럼이 있는 경우, 체크 제약만 갱신(기타 추가)
alter table app_260712_tosb.surveys drop constraint if exists surveys_category_check;
alter table app_260712_tosb.surveys add constraint surveys_category_check check (category in ('consulting', 'research', 'other'));
